import { config } from '../config.js';
import type { Db } from '../db/index.js';
import { findMembership } from '../group/membership.js';
import { learnFromMessage } from '../knowledge/service.js';
import type { ActivityMatcher, KnowledgeExtractor } from '../knowledge/types.js';
import { logger } from '../logger.js';
import { findSenderByContact, insertGroupMessage } from './repository.js';
import {
  maskIdentity,
  OutboundMessageError,
  type InboundGroupMessage,
  type Messenger,
} from './types.js';

/**
 * What happens to an inbound group message, independent of which transport
 * delivered it. Contains no provider-specific parsing.
 */

export type IngestOutcome =
  | 'stored'
  | 'duplicate'
  | 'unknown_sender'
  | 'ingestion_denied'
  | 'unsupported_content'
  | 'storage_failed';

export interface MessagingDeps {
  db: Db;
  /** Absent when the transport is not configured for sending. */
  messenger?: Messenger | undefined;
  /** Absent when no AI provider is configured; ingestion still works. */
  extractor?: KnowledgeExtractor | undefined;
  /** Judges whether a new event restates one Charlie already knows. */
  matcher?: ActivityMatcher | undefined;
}

/**
 * How Charlie acknowledges. Deliberately dumb and deterministic; no AI wrote
 * any of it.
 *
 * Both outcomes are reactions rather than sentences. The thread belongs to the
 * family, and during an outage a reply-per-message would fill it with bot noise
 * exactly when things are already going wrong. A reaction takes no turn in the
 * conversation, so an hour-long outage leaves the thread unchanged.
 */
const ACKNOWLEDGEMENT_TEXT = "Got it. I've saved your message.";

export async function ingestInboundMessage(
  message: InboundGroupMessage,
  deps: MessagingDeps,
): Promise<IngestOutcome> {
  const logContext = {
    channel: message.channel,
    externalMessageId: message.externalMessageId,
    sender: maskIdentity(message.senderExternalId),
  };

  // Milestone 3 handles text only. Media is recognized and normalized so a
  // later milestone can fetch it, but nothing is downloaded or persisted.
  if (message.text === undefined || message.text === '') {
    logger.info('recognized unsupported inbound media message', {
      ...logContext,
      mediaCount: message.media.length,
      mediaTypes: message.media.map((item) => item.mediaType ?? 'unknown'),
    });
    return 'unsupported_content';
  }

  let stored: boolean;
  try {
    const sender = await findSenderByContact(deps.db, message.channel, message.senderExternalId);

    if (!sender) {
      // Deliberately does nothing else: no person is created, no message is
      // stored, and no reply is sent. Replying would confirm to an unknown
      // number that this line is active, and storing would attach a stranger's
      // words to a household they are not part of.
      logger.warn('inbound message from unrecognized sender', logContext);
      return 'unknown_sender';
    }

    // Membership and ingestion permission are checked before the message is
    // stored, so a blocked member's words never enter Charlie's knowledge at
    // all -- and the extractor is unreachable from this branch by construction.
    const membership = await findMembership(deps.db, sender.householdId, sender.personId);

    if (!membership || membership.ingestionStatus !== 'allowed') {
      logger.warn('ingestion denied for sender', {
        ...logContext,
        ingestionStatus: membership?.ingestionStatus ?? 'not_a_member',
      });
      return 'ingestion_denied';
    }

    stored = await insertGroupMessage(deps.db, message, sender);
  } catch (error: unknown) {
    // Covers both the sender lookup and the insert: either failing means we
    // cannot honestly say the message was saved.
    logger.error('failed to store inbound group message', {
      ...logContext,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    // Never claim to have saved something that was not saved. Unlike the
    // success path this does NOT fall back to text: an outage means every
    // message from every person fails, and a reply each would be exactly the
    // clutter this design exists to avoid. The diagnostic belongs in the logs,
    // and later with admins -- not in the family's thread.
    await tryReact(deps.messenger, message, config.messaging.reactions.problem, logContext);
    return 'storage_failed';
  }

  if (!stored) {
    // A provider redelivery of a message we already have. Staying silent keeps
    // retries from acknowledging the same message repeatedly.
    logger.info('ignored duplicate provider delivery', logContext);
    return 'duplicate';
  }

  logger.info('stored inbound group message', { ...logContext, messageStored: true });

  // Extraction runs only for a stored message from an allowed sender. It is
  // deliberately not allowed to affect the outcome: a provider failure leaves
  // the source message exactly as stored, available for reprocessing.
  const storedId = await findStoredMessageId(deps.db, message);
  if (storedId) {
    await learnFromMessage(deps.db, storedId, deps.extractor, deps.matcher);
  }

  // Acknowledgement is best-effort: the message is already safely stored, and
  // a failure to reply must not undo that. It never claims more than storage --
  // Charlie does not announce what it learned.
  await tryAcknowledge(deps.messenger, message, logContext);

  return 'stored';
}

async function findStoredMessageId(
  db: Db,
  message: InboundGroupMessage,
): Promise<string | null> {
  const result = await db.query(
    'SELECT id FROM group_message WHERE channel = $1 AND external_message_id = $2',
    [message.channel, message.externalMessageId],
  );
  return (result.rows[0]?.['id'] as string | undefined) ?? null;
}

/**
 * Reacts to the message. Falls back to a sentence if the reaction itself fails,
 * so a provider that will not accept reactions leaves the sender with some
 * signal rather than silence -- which is indistinguishable from Charlie being
 * broken.
 */
async function tryAcknowledge(
  messenger: Messenger | undefined,
  message: InboundGroupMessage,
  logContext: Record<string, unknown>,
): Promise<void> {
  const reacted = await tryReact(
    messenger,
    message,
    config.messaging.reactions.saved,
    logContext,
  );
  if (reacted) return;

  // Only the success path falls back to words: a person who sent something and
  // gets no signal at all cannot tell Charlie apart from broken, and success is
  // not the case where an outage is producing one failure per message.
  await trySend(messenger, message.senderExternalId, ACKNOWLEDGEMENT_TEXT, logContext);
}

/** Returns whether the reaction was delivered. */
async function tryReact(
  messenger: Messenger | undefined,
  message: InboundGroupMessage,
  emoji: string,
  logContext: Record<string, unknown>,
): Promise<boolean> {
  if (!messenger) {
    logger.warn('no outbound messenger configured, skipping acknowledgement', logContext);
    return false;
  }
  try {
    await messenger.react(message.senderExternalId, message.externalMessageId, emoji);
    return true;
  } catch (error: unknown) {
    logOutboundFailure(error, { ...logContext, acknowledgement: 'reaction' });
    return false;
  }
}

function logOutboundFailure(error: unknown, logContext: Record<string, unknown>): void {
  // Classified so an expired credential is distinguishable from a network
  // blip. Inbound ingestion is unaffected either way -- see README.
  if (error instanceof OutboundMessageError) {
    logger.error('whatsapp outbound failed', {
      ...logContext,
      category: error.category,
      httpStatus: error.httpStatus,
      providerCode: error.providerCode,
    });
    return;
  }
  logger.error('whatsapp outbound failed', {
    ...logContext,
    category: 'unknown',
    reason: error instanceof Error ? error.message : 'unknown',
  });
}

async function trySend(
  messenger: Messenger | undefined,
  to: string,
  text: string,
  logContext: Record<string, unknown>,
): Promise<void> {
  if (!messenger) {
    logger.warn('no outbound messenger configured, skipping reply', logContext);
    return;
  }
  try {
    await messenger.sendText(to, text);
  } catch (error: unknown) {
    logOutboundFailure(error, logContext);
  }
}

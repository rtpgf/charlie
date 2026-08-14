import type { Db } from '../db/index.js';
import { findMembership } from '../group/membership.js';
import { learnFromMessage } from '../knowledge/service.js';
import type { KnowledgeExtractor } from '../knowledge/types.js';
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
}

/** Deliberately dumb and deterministic. No AI authored this. */
const ACKNOWLEDGEMENT = "Got it. I've saved your message.";
const STORAGE_FAILURE = "I'm having trouble saving that right now. Please try again later.";

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
    await trySend(deps.messenger, message.senderExternalId, STORAGE_FAILURE, logContext);
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
    await learnFromMessage(deps.db, storedId, deps.extractor);
  }

  // Acknowledgement is best-effort: the message is already safely stored, and
  // a failure to reply must not undo that. The wording never claims more than
  // storage -- Charlie does not announce what it learned.
  await trySend(deps.messenger, message.senderExternalId, ACKNOWLEDGEMENT, logContext);

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
}

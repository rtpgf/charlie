import type { Db } from '../db/index.js';
import { logger } from '../logger.js';
import { findSenderByContact, insertGroupMessage } from './repository.js';
import { maskIdentity, type InboundGroupMessage, type Messenger } from './types.js';

/**
 * What happens to an inbound group message, independent of which transport
 * delivered it. Contains no provider-specific parsing.
 */

export type IngestOutcome =
  | 'stored'
  | 'duplicate'
  | 'unknown_sender'
  | 'unsupported_content'
  | 'storage_failed';

export interface MessagingDeps {
  db: Db;
  /** Absent when the transport is not configured for sending. */
  messenger?: Messenger | undefined;
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

  // Acknowledgement is best-effort: the message is already safely stored, and
  // a failure to reply must not undo that.
  await trySend(deps.messenger, message.senderExternalId, ACKNOWLEDGEMENT, logContext);

  return 'stored';
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
    logger.error('failed to send outbound message', {
      ...logContext,
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }
}

import type { Db } from '../db/index.js';
import { loadGroupGraph } from '../group/repository.js';
import { findPersonById } from '../group/graph.js';
import { logger } from '../logger.js';
import {
  findGroupMessage,
  findHouseholdTimezone,
  hasAcceptedExtraction,
  insertEvents,
  insertExtraction,
} from './repository.js';
import { EXTRACTION_SCHEMA_VERSION, type KnowledgeExtractor } from './types.js';
import { validateProposal } from './validate.js';

/**
 * AI proposal -> deterministic validation -> accepted knowledge.
 *
 * The model never writes to the database. It returns a proposal; this module
 * validates it, resolves people against Charlie's own records, converts dates
 * using the group's timezone, and only then persists.
 */

export type LearnOutcome =
  | 'learned'
  | 'nothing_to_learn'
  | 'already_learned'
  | 'rejected'
  | 'extractor_unavailable'
  | 'failed';

export interface LearnResult {
  outcome: LearnOutcome;
  eventsAccepted: number;
}

export async function learnFromMessage(
  db: Db,
  groupMessageId: string,
  extractor: KnowledgeExtractor | undefined,
): Promise<LearnResult> {
  const logContext = { messageId: groupMessageId };

  if (!extractor) {
    logger.warn('no knowledge extractor configured, message stored without extraction', logContext);
    return { outcome: 'extractor_unavailable', eventsAccepted: 0 };
  }

  const message = await findGroupMessage(db, groupMessageId);
  if (!message) {
    logger.warn('cannot extract from unknown message', logContext);
    return { outcome: 'failed', eventsAccepted: 0 };
  }

  // Guards the whole pipeline against repeats: a redelivered webhook or a
  // second reprocess never calls the provider again, let alone stores again.
  if (await hasAcceptedExtraction(db, groupMessageId)) {
    logger.info('message already has an accepted extraction', logContext);
    return { outcome: 'already_learned', eventsAccepted: 0 };
  }

  const [graph, timezone] = await Promise.all([
    loadGroupGraph(db, message.householdId),
    findHouseholdTimezone(db, message.householdId),
  ]);

  const sender = findPersonById(graph, message.senderPersonId);
  const receivedAt = message.providerReceivedAt ?? new Date();

  logger.info('knowledge extraction started', {
    ...logContext,
    groupId: message.householdId,
    provider: extractor.provider,
  });

  let proposal: unknown;
  try {
    proposal = await extractor.extractFromMessage({
      text: message.body,
      sender: { preferredName: sender?.preferredName ?? 'someone in the group' },
      group: {
        timezone,
        // Minimum context for entity resolution -- not the whole group model.
        knownPeople: graph.people.map((person) => ({
          preferredName: person.preferredName,
          aliases: [person.fullName, ...person.aliases].filter(
            (name): name is string => Boolean(name),
          ),
        })),
      },
      receivedAt,
    });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'unknown';
    logger.error('knowledge extraction failed', { ...logContext, reason });
    // The source message stays exactly as stored, and remains reprocessable.
    await insertExtraction(db, {
      groupMessageId,
      provider: extractor.provider,
      model: extractor.model,
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      status: 'failed',
      error: reason.slice(0, 500),
    });
    return { outcome: 'failed', eventsAccepted: 0 };
  }

  let validated;
  try {
    validated = validateProposal(proposal, { graph, timezone, messageReceivedAt: receivedAt });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'unknown';
    logger.warn('knowledge extraction rejected', { ...logContext, reason });
    await insertExtraction(db, {
      groupMessageId,
      provider: extractor.provider,
      model: extractor.model,
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      status: 'rejected',
      error: reason.slice(0, 500),
    });
    return { outcome: 'rejected', eventsAccepted: 0 };
  }

  if (validated.rejections.length > 0) {
    logger.warn('some proposed events were rejected', {
      ...logContext,
      rejected: validated.rejections.length,
      reasons: validated.rejections,
    });
  }

  // Events first, then the accepted marker: if the process dies between the
  // two, a retry re-inserts nothing (unique on source_id + sequence) and
  // completes the marker. The reverse order could strand a message with an
  // accepted extraction and no events, unretryable.
  const eventsAccepted = await insertEvents(db, {
    householdId: message.householdId,
    sourceMessageId: message.id,
    events: validated.events,
  });

  await insertExtraction(db, {
    groupMessageId,
    provider: extractor.provider,
    model: extractor.model,
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    status: 'accepted',
    proposal,
  });

  logger.info('knowledge extraction succeeded', {
    ...logContext,
    eventsProposed: validated.events.length,
    eventsAccepted,
    eventsRejected: validated.rejections.length,
  });

  return {
    outcome: validated.events.length === 0 ? 'nothing_to_learn' : 'learned',
    eventsAccepted,
  };
}

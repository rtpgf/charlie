import type { Db } from '../db/index.js';
import type { ExistingEvent } from './identity.js';
import type { ActivityMatcher } from './types.js';
import { matchWithinSlot } from './identity.js';
import { instantToLocalDate } from './timezone.js';
import type { AcceptedEvent } from './validate.js';

/** All SQL for extraction records and accepted events. */

export interface ExtractionRecord {
  groupMessageId: string;
  provider: string;
  model: string;
  schemaVersion: string;
  status: 'accepted' | 'rejected' | 'failed';
  error?: string | null;
  /** Structured proposal only -- never provider reasoning or raw payloads. */
  proposal?: unknown;
}

export async function hasAcceptedExtraction(db: Db, groupMessageId: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM knowledge_extraction
      WHERE group_message_id = $1 AND status = 'accepted'`,
    [groupMessageId],
  );
  return result.rows.length > 0;
}

/**
 * Records an extraction attempt. The accepted case is guarded by a partial
 * unique index, so a concurrent or repeated success cannot double-record.
 */
export async function insertExtraction(db: Db, record: ExtractionRecord): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO knowledge_extraction
       (group_message_id, provider, model, schema_version, status, error, proposal)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (group_message_id) WHERE status = 'accepted' DO NOTHING
     RETURNING id`,
    [
      record.groupMessageId,
      record.provider,
      record.model,
      record.schemaVersion,
      record.status,
      record.error ?? null,
      record.proposal === undefined ? null : JSON.stringify(record.proposal),
    ],
  );
  return result.rows.length > 0;
}

/**
 * Stores accepted events for a message. `sourceSequence` is the event's position
 * in the proposal: together with the message id it makes reprocessing idempotent,
 * so a retried extraction cannot produce a second copy of the same event.
 */
/** Live events already known in a candidate's slot: same group, subject, day. */
async function findSlotCandidates(
  db: Db,
  input: { householdId: string; subjectPersonId: string | null; localDate: string | null },
): Promise<ExistingEvent[]> {
  // An unresolved subject or an undated event has no usable slot. Matching on
  // those would compare unrelated things, so they are simply never merged.
  if (!input.subjectPersonId || !input.localDate) return [];

  const result = await db.query(
    `SELECT id, activity, starts_at, time_precision, status
       FROM group_event
      WHERE household_id = $1 AND subject_person_id = $2 AND local_date = $3
        AND superseded_by IS NULL`,
    [input.householdId, input.subjectPersonId, input.localDate],
  );

  return result.rows.map((row) => ({
    id: row['id'] as string,
    activity: row['activity'] as string,
    startsAt: (row['starts_at'] as Date | null) ?? null,
    timePrecision: row['time_precision'] as ExistingEvent['timePrecision'],
    status: row['status'] as ExistingEvent['status'],
  }));
}

async function supersede(
  db: Db,
  input: { eventId: string; replacedBy: string | null; reason: 'duplicate' | 'updated' | 'cancelled' },
): Promise<void> {
  await db.query(
    `UPDATE group_event
        SET superseded_by = $1, superseded_reason = $2, updated_at = now()
      WHERE id = $3`,
    [input.replacedBy, input.reason, input.eventId],
  );
}

export interface EventWriteResult {
  inserted: number;
  duplicates: number;
  updates: number;
  cancellations: number;
}

/**
 * Stores accepted events, reconciling each against what Charlie already knows.
 *
 * `sourceSequence` still makes reprocessing the *same* message idempotent.
 * Slot matching handles the different problem: two *different* messages
 * describing the same gathering. Nothing is ever deleted -- a superseded event
 * keeps its row and its link to the message it came from.
 */
export async function insertEvents(
  db: Db,
  input: {
    householdId: string;
    sourceMessageId: string;
    events: AcceptedEvent[];
    timezone: string;
    /** Absent when no AI is configured; falls back to word overlap. */
    matcher?: ActivityMatcher | undefined;
  },
): Promise<EventWriteResult> {
  const result: EventWriteResult = { inserted: 0, duplicates: 0, updates: 0, cancellations: 0 };

  for (const [index, event] of input.events.entries()) {
    const subjectPersonId = event.subject?.person?.id ?? null;
    const localDate = event.startsAt ? instantToLocalDate(event.startsAt, input.timezone) : null;

    const candidates = await findSlotCandidates(db, {
      householdId: input.householdId,
      subjectPersonId,
      localDate,
    });
    const decision =
      candidates.length === 0
        ? ({ kind: 'distinct' } as const)
        : await matchWithinSlot(event, candidates, {
            localDate: localDate!,
            matcher: input.matcher,
          });

    // A duplicate adds nothing Charlie does not already hold, so the new event
    // is not stored at all -- the existing row already carries its own
    // provenance, and the source message remains linked through its extraction.
    if (decision.kind === 'duplicate') {
      result.duplicates += 1;
      continue;
    }

    const inserted = await db.query(
      `INSERT INTO group_event
         (household_id, subject, subject_person_id, activity, description, starts_at,
          local_date, date_precision, time_precision, status, confidence,
          source_type, source_id, source_sequence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'group_message', $12, $13)
       ON CONFLICT (source_id, source_sequence) DO NOTHING
       RETURNING id`,
      [
        input.householdId,
        // Prefer Charlie's own preferred name once the subject resolves.
        event.subject?.person?.preferredName ?? event.subject?.name ?? null,
        subjectPersonId,
        event.activity,
        event.description,
        event.startsAt,
        localDate,
        event.datePrecision,
        event.timePrecision,
        event.status,
        event.confidence,
        input.sourceMessageId,
        index,
      ],
    );

    const row = inserted.rows[0];
    if (!row) continue; // already stored by an earlier run of this same message
    result.inserted += 1;

    if (decision.kind === 'updated' || decision.kind === 'cancelled') {
      await supersede(db, {
        eventId: decision.existingId,
        replacedBy: row['id'] as string,
        reason: decision.kind,
      });
      if (decision.kind === 'updated') result.updates += 1;
      else result.cancellations += 1;
    }

    for (const participant of event.participants) {
      await db.query(
        `INSERT INTO group_event_participant (event_id, person_id, unresolved_name)
         VALUES ($1, $2, $3)`,
        [row['id'], participant.person?.id ?? null, participant.person ? null : participant.name],
      );
    }
  }

  return result;
}

export interface StoredMessage {
  id: string;
  householdId: string;
  senderPersonId: string;
  body: string;
  providerReceivedAt: Date | null;
}

export async function findGroupMessage(db: Db, id: string): Promise<StoredMessage | null> {
  const result = await db.query(
    `SELECT id, household_id, sender_person_id, body, provider_received_at
       FROM group_message WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row['id'] as string,
    householdId: row['household_id'] as string,
    senderPersonId: row['sender_person_id'] as string,
    body: row['body'] as string,
    providerReceivedAt: (row['provider_received_at'] as Date | null) ?? null,
  };
}

export async function findHouseholdTimezone(db: Db, householdId: string): Promise<string> {
  const result = await db.query('SELECT timezone FROM household WHERE id = $1', [householdId]);
  return (result.rows[0]?.['timezone'] as string | undefined) ?? 'UTC';
}

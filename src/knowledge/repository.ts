import type { Db } from '../db/index.js';
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
export async function insertEvents(
  db: Db,
  input: { householdId: string; sourceMessageId: string; events: AcceptedEvent[] },
): Promise<number> {
  let inserted = 0;

  for (const [index, event] of input.events.entries()) {
    const result = await db.query(
      `INSERT INTO group_event
         (household_id, subject, activity, description, starts_at, date_precision,
          time_precision, status, confidence, source_type, source_id, source_sequence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'group_message', $10, $11)
       ON CONFLICT (source_id, source_sequence) DO NOTHING
       RETURNING id`,
      [
        input.householdId,
        // Prefer Charlie's own preferred name once the subject resolves.
        event.subject?.person?.preferredName ?? event.subject?.name ?? null,
        event.activity,
        event.description,
        event.startsAt,
        event.datePrecision,
        event.timePrecision,
        event.status,
        event.confidence,
        input.sourceMessageId,
        index,
      ],
    );

    const row = result.rows[0];
    if (!row) continue; // already stored by an earlier run
    inserted += 1;

    for (const participant of event.participants) {
      await db.query(
        `INSERT INTO group_event_participant (event_id, person_id, unresolved_name)
         VALUES ($1, $2, $3)`,
        [row['id'], participant.person?.id ?? null, participant.person ? null : participant.name],
      );
    }
  }

  return inserted;
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

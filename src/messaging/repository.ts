import type { Db } from '../db/index.js';
import type { InboundGroupMessage, MessageChannel } from './types.js';

/** All SQL for group messaging. */

export interface SenderIdentity {
  personId: string;
  householdId: string;
}

export async function findSenderByContact(
  db: Db,
  channel: MessageChannel,
  externalId: string,
): Promise<SenderIdentity | null> {
  const result = await db.query(
    `SELECT p.id AS person_id, p.household_id
       FROM person_contact c
       JOIN person p ON p.id = c.person_id
      WHERE c.channel = $1 AND c.external_id = $2`,
    [channel, externalId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { personId: row['person_id'] as string, householdId: row['household_id'] as string };
}

/**
 * Stores an inbound message, ignoring a provider redelivery of one already
 * stored. Returns false when the message was already present, which is how the
 * caller knows not to acknowledge twice.
 */
export async function insertGroupMessage(
  db: Db,
  message: InboundGroupMessage,
  sender: SenderIdentity,
): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO group_message
       (household_id, sender_person_id, channel, external_message_id,
        sender_external_id, recipient_external_id, body, provider_received_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (channel, external_message_id) DO NOTHING
     RETURNING id`,
    [
      sender.householdId,
      sender.personId,
      message.channel,
      message.externalMessageId,
      message.senderExternalId,
      message.recipientExternalId ?? null,
      message.text ?? '',
      message.receivedAt,
    ],
  );
  return result.rows.length > 0;
}

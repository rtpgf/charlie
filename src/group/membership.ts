import type { Db } from '../db/index.js';
import { logger } from '../logger.js';

/**
 * Group membership, roles, and message-ingestion permission.
 *
 * Three separate concerns, deliberately not collapsed:
 *   - membership: who belongs to the group
 *   - role: who may administer it
 *   - ingestion status: whose messages Charlie may learn from
 * Alexa/query access is a fourth concept, not modelled yet.
 */

export type GroupRole = 'admin' | 'member';
export type IngestionStatus = 'allowed' | 'blocked' | 'pending';

export interface Membership {
  id: string;
  householdId: string;
  personId: string;
  role: GroupRole;
  ingestionStatus: IngestionStatus;
}

/** Thrown when the acting person lacks authority. Never surfaced to a user. */
export class NotAuthorizedError extends Error {
  constructor(message = 'not authorized') {
    super(message);
    this.name = 'NotAuthorizedError';
  }
}

function toMembership(row: Record<string, unknown>): Membership {
  return {
    id: row['id'] as string,
    householdId: row['household_id'] as string,
    personId: row['person_id'] as string,
    role: row['role'] as GroupRole,
    ingestionStatus: row['ingestion_status'] as IngestionStatus,
  };
}

export async function findMembership(
  db: Db,
  householdId: string,
  personId: string,
): Promise<Membership | null> {
  const result = await db.query(
    `SELECT id, household_id, person_id, role, ingestion_status
       FROM group_membership WHERE household_id = $1 AND person_id = $2`,
    [householdId, personId],
  );
  const row = result.rows[0];
  return row ? toMembership(row) : null;
}

export async function findMembershipById(db: Db, id: string): Promise<Membership | null> {
  const result = await db.query(
    `SELECT id, household_id, person_id, role, ingestion_status
       FROM group_membership WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? toMembership(row) : null;
}

/**
 * Changes whose messages Charlie may learn from.
 *
 * Authorization is enforced here, in the domain layer, rather than left to a
 * future UI: an ordinary member cannot change anyone's ingestion status,
 * including their own.
 */
export async function setMemberIngestionStatus(
  db: Db,
  input: { actingPersonId: string; targetMembershipId: string; status: IngestionStatus },
): Promise<Membership> {
  const target = await findMembershipById(db, input.targetMembershipId);
  if (!target) throw new NotAuthorizedError('unknown membership');

  const actor = await findMembership(db, target.householdId, input.actingPersonId);

  // An actor outside the group is indistinguishable from a non-admin here:
  // both are simply not authorized.
  if (!actor || actor.role !== 'admin') {
    logger.warn('rejected ingestion status change by non-admin', {
      householdId: target.householdId,
    });
    throw new NotAuthorizedError();
  }

  const updated = await db.query(
    `UPDATE group_membership
        SET ingestion_status = $1, updated_at = now()
      WHERE id = $2
      RETURNING id, household_id, person_id, role, ingestion_status`,
    [input.status, input.targetMembershipId],
  );

  logger.info('ingestion status changed', {
    householdId: target.householdId,
    status: input.status,
  });

  return toMembership(updated.rows[0]!);
}

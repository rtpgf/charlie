import { PGlite } from '@electric-sql/pglite';

import type { Db } from '../../src/db/index.js';
import { migrate } from '../../src/db/migrate.js';
import { seedWeekendCharlie } from '../../src/db/seed.js';

/**
 * A real, migrated Postgres for tests. PGlite is PostgreSQL compiled to WASM,
 * so the SQL under test is the same SQL that runs against Supabase -- but it
 * needs no server, no install, and no cloud account.
 */
export async function createTestDb(): Promise<Db> {
  const db = new PGlite() as unknown as Db;
  await migrate(db);
  return db;
}

export async function createSeededTestDb(
  options: { alexaUserId?: string } = {},
): Promise<{ db: Db; householdId: string }> {
  const db = await createTestDb();
  const { householdId } = await seedWeekendCharlie(db, options);
  return { db, householdId };
}

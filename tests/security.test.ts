import { describe, expect, it } from 'vitest';

import { createSeededTestDb } from './helpers/db.js';

/**
 * Properties that must hold of the database itself, whatever else changes.
 *
 * Checked against a freshly migrated database, so these are assertions about
 * the migrations rather than about whatever a developer's Supabase project
 * happens to look like today.
 */
describe('row-level security', () => {
  it('is enabled on every table Charlie creates', async () => {
    const { db } = await createSeededTestDb();

    const unprotected = await db.query(
      `SELECT c.relname AS name
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
        ORDER BY c.relname`,
    );

    // Supabase serves every table in `public` over its Data API to a role that
    // authenticates with a publishable key. RLS with no policies denies that
    // role everything. A new table without it is a new hole, so this fails the
    // moment one is added rather than when someone reads a warning email.
    expect(unprotected.rows.map((row) => row['name'])).toEqual([]);
  });

  it('grants nobody access, rather than granting the wrong body access', async () => {
    const { db } = await createSeededTestDb();

    const policies = await db.query(`SELECT tablename, policyname FROM pg_policies`);

    // There is no case in which the Data API should reach a family's messages,
    // so there is no policy. A policy appearing here means someone decided
    // otherwise, and should have to say why.
    expect(policies.rows).toEqual([]);
  });

  it('never forces RLS on the owner, which would lock Charlie out', async () => {
    const { db } = await createSeededTestDb();

    const forced = await db.query(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity`,
    );

    // Charlie connects as the table owner and relies on owners bypassing RLS.
    expect(forced.rows).toEqual([]);
  });
});

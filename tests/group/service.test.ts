import { describe, expect, it } from 'vitest';

import { seedWeekendCharlie } from '../../src/db/seed.js';
import { answerWhoIs, resolveHousehold } from '../../src/group/service.js';
import { createSeededTestDb, createTestDb } from '../helpers/db.js';

const ALEXA_USER = 'amzn1.ask.account.test-household-owner';

describe('household resolution', () => {
  it('resolves a mapped Alexa user to their household', async () => {
    const { db, householdId } = await createSeededTestDb({ alexaUserId: ALEXA_USER });

    expect(await resolveHousehold(db, ALEXA_USER)).toBe(householdId);
  });

  it('returns null for an Alexa user with no household', async () => {
    const { db } = await createSeededTestDb({ alexaUserId: ALEXA_USER });

    expect(await resolveHousehold(db, 'amzn1.ask.account.someone-else')).toBeNull();
  });

  it('seeds no mapping when no Alexa user is supplied', async () => {
    const db = await createTestDb();
    const result = await seedWeekendCharlie(db);

    expect(result.alexaUserMapped).toBe(false);
    expect(await resolveHousehold(db, ALEXA_USER)).toBeNull();
  });
});

describe('answerWhoIs', () => {
  it('answers from stored data', async () => {
    const { db, householdId } = await createSeededTestDb();

    expect(await answerWhoIs(db, householdId, 'Natalie')).toBe(
      "Natalie is Hannah's daughter and Jenna's niece.",
    );
  });

  it('answers for a person reached by alias', async () => {
    const { db, householdId } = await createSeededTestDb();

    expect(await answerWhoIs(db, householdId, 'james thomas')).toBe(
      "JT is James Thomas. He's Hannah's son and Jenna's nephew.",
    );
  });

  it('says it does not know an unknown person', async () => {
    const { db, householdId } = await createSeededTestDb();

    expect(await answerWhoIs(db, householdId, 'Robert')).toBe(
      "I don't think I know anyone named Robert yet.",
    );
  });

  it('declines to guess when a name is ambiguous', async () => {
    const { db, householdId } = await createSeededTestDb();
    // A second Hannah makes the name ambiguous.
    await db.query(
      `INSERT INTO person (household_id, preferred_name, gender) VALUES ($1, 'Hannah', 'female')`,
      [householdId],
    );

    const answer = await answerWhoIs(db, householdId, 'Hannah');

    expect(answer).toContain('more than one person named Hannah');
  });
});

describe('seed', () => {
  it('is idempotent', async () => {
    const db = await createTestDb();
    const first = await seedWeekendCharlie(db);
    const second = await seedWeekendCharlie(db);

    expect(second.householdId).not.toBe(first.householdId);

    const households = await db.query('SELECT count(*)::int AS count FROM household');
    expect(households.rows[0]!['count']).toBe(1);

    const people = await db.query('SELECT count(*)::int AS count FROM person');
    expect(people.rows[0]!['count']).toBe(4);
  });

  it('records provenance on every relationship', async () => {
    const { db } = await createSeededTestDb();

    const rows = await db.query('SELECT source_type, confidence FROM relationship');

    expect(rows.rows).toHaveLength(3);
    for (const row of rows.rows) {
      expect(row['source_type']).toBe('seed');
      expect(row['confidence']).toBe('confirmed');
    }
  });

  it('stores only asserted relationships, never derived ones', async () => {
    const { db } = await createSeededTestDb();

    const rows = await db.query('SELECT relationship_type FROM relationship');
    const types = rows.rows.map((row) => row['relationship_type']);

    expect(types.sort()).toEqual(['parent_of', 'parent_of', 'sibling_of']);
  });
});

import type { Db } from '../db/index.js';
import type { GroupGraph, Gender, Person, RelationshipType } from './graph.js';

/**
 * All SQL for the group model lives here. A household is small, so its people
 * and asserted relationships are loaded in full and reasoned about in memory
 * (see graph.ts) rather than expressed as recursive queries.
 */

export async function findHouseholdIdForAlexaUser(
  db: Db,
  alexaUserId: string,
): Promise<string | null> {
  const result = await db.query('SELECT household_id FROM alexa_user WHERE alexa_user_id = $1', [
    alexaUserId,
  ]);
  const row = result.rows[0];
  return row ? (row['household_id'] as string) : null;
}

export async function loadGroupGraph(db: Db, householdId: string): Promise<GroupGraph> {
  const people = await db.query(
    `SELECT id, full_name, preferred_name, gender FROM person WHERE household_id = $1`,
    [householdId],
  );

  const aliases = await db.query(
    `SELECT a.person_id, a.alias
       FROM person_alias a
       JOIN person p ON p.id = a.person_id
      WHERE p.household_id = $1`,
    [householdId],
  );

  const aliasesByPerson = new Map<string, string[]>();
  for (const row of aliases.rows) {
    const personId = row['person_id'] as string;
    const list = aliasesByPerson.get(personId) ?? [];
    list.push(row['alias'] as string);
    aliasesByPerson.set(personId, list);
  }

  const relationships = await db.query(
    `SELECT subject_person_id, relationship_type, object_person_id
       FROM relationship WHERE household_id = $1`,
    [householdId],
  );

  return {
    people: people.rows.map(
      (row): Person => ({
        id: row['id'] as string,
        fullName: (row['full_name'] as string | null) ?? null,
        preferredName: row['preferred_name'] as string,
        gender: (row['gender'] as Gender) ?? null,
        aliases: aliasesByPerson.get(row['id'] as string) ?? [],
      }),
    ),
    relationships: relationships.rows.map((row) => ({
      subjectId: row['subject_person_id'] as string,
      type: row['relationship_type'] as RelationshipType,
      objectId: row['object_person_id'] as string,
    })),
  };
}

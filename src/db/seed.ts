import type { Db } from './index.js';

export const HOUSEHOLD_NAME = 'Weekend Charlie';

/** Provenance for everything this seed writes. */
const SOURCE_TYPE = 'seed';
const CONFIDENCE = 'confirmed';

interface SeedPerson {
  key: string;
  fullName: string | null;
  preferredName: string;
  /** Only ever set from an explicit statement -- never inferred from a name. */
  gender: 'female' | 'male' | null;
  aliases: string[];
}

const PEOPLE: SeedPerson[] = [
  { key: 'jenna', fullName: null, preferredName: 'Jenna', gender: 'female', aliases: [] },
  { key: 'hannah', fullName: null, preferredName: 'Hannah', gender: 'female', aliases: [] },
  {
    key: 'natalie',
    fullName: 'Natalie Rose',
    preferredName: 'Natalie',
    gender: 'female',
    aliases: ['Natalie Rose'],
  },
  {
    key: 'jt',
    fullName: 'James Thomas',
    preferredName: 'JT',
    gender: 'male',
    aliases: ['JT', 'James', 'James Thomas'],
  },
];

/** Only asserted relationships. Aunt/niece/nephew are derived, never stored. */
const RELATIONSHIPS: Array<{ subject: string; type: 'parent_of' | 'sibling_of'; object: string }> = [
  { subject: 'jenna', type: 'sibling_of', object: 'hannah' },
  { subject: 'hannah', type: 'parent_of', object: 'natalie' },
  { subject: 'hannah', type: 'parent_of', object: 'jt' },
];

export interface SeedResult {
  householdId: string;
  alexaUserMapped: boolean;
}

/**
 * Rebuilds the development household from scratch. Idempotent: running it twice
 * leaves the same data, so it is safe to re-run after schema changes.
 */
export async function seedWeekendCharlie(
  db: Db,
  options: { alexaUserId?: string | undefined } = {},
): Promise<SeedResult> {
  // Cascades through people, aliases, relationships and the Alexa mapping.
  await db.query('DELETE FROM household WHERE name = $1', [HOUSEHOLD_NAME]);

  const household = await db.query('INSERT INTO household (name) VALUES ($1) RETURNING id', [
    HOUSEHOLD_NAME,
  ]);
  const householdId = household.rows[0]!['id'] as string;

  const personIds = new Map<string, string>();
  for (const person of PEOPLE) {
    const inserted = await db.query(
      `INSERT INTO person (household_id, full_name, preferred_name, gender)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [householdId, person.fullName, person.preferredName, person.gender],
    );
    const personId = inserted.rows[0]!['id'] as string;
    personIds.set(person.key, personId);

    for (const alias of person.aliases) {
      await db.query('INSERT INTO person_alias (person_id, alias) VALUES ($1, $2)', [
        personId,
        alias,
      ]);
    }
  }

  for (const relationship of RELATIONSHIPS) {
    await db.query(
      `INSERT INTO relationship
         (household_id, subject_person_id, relationship_type, object_person_id,
          source_type, confidence)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        householdId,
        personIds.get(relationship.subject),
        relationship.type,
        personIds.get(relationship.object),
        SOURCE_TYPE,
        CONFIDENCE,
      ],
    );
  }

  if (options.alexaUserId) {
    await db.query(
      `INSERT INTO alexa_user (alexa_user_id, household_id) VALUES ($1, $2)
       ON CONFLICT (alexa_user_id) DO UPDATE SET household_id = EXCLUDED.household_id`,
      [options.alexaUserId, householdId],
    );
  }

  return { householdId, alexaUserMapped: Boolean(options.alexaUserId) };
}

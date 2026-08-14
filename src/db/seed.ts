import type { Db } from './index.js';
import { normalizePhoneIdentity } from '../messaging/types.js';

export const HOUSEHOLD_NAME = 'Weekend Charlie';

/** Relative dates in messages resolve against this. */
export const HOUSEHOLD_TIMEZONE = 'America/Chicago';

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
  /** Authorization, independent of any relationship in the group model. */
  role: 'admin' | 'member';
  /** Whether Charlie may learn from this person's messages. */
  ingestionStatus: 'allowed' | 'blocked' | 'pending';
}

const PEOPLE: SeedPerson[] = [
  {
    key: 'jenna',
    fullName: null,
    preferredName: 'Jenna',
    gender: 'female',
    aliases: [],
    role: 'admin',
    ingestionStatus: 'allowed',
  },
  {
    key: 'hannah',
    fullName: null,
    preferredName: 'Hannah',
    gender: 'female',
    aliases: [],
    role: 'member',
    ingestionStatus: 'allowed',
  },
  {
    key: 'natalie',
    fullName: 'Natalie Rose',
    preferredName: 'Natalie',
    gender: 'female',
    aliases: ['Natalie Rose'],
    role: 'member',
    ingestionStatus: 'pending',
  },
  {
    key: 'jt',
    fullName: 'James Thomas',
    preferredName: 'JT',
    gender: 'male',
    // Includes how speech-to-text is likely to transcribe "JT". Phonetic
    // variants live here, per person, so adding a group member never requires
    // editing the Alexa interaction model.
    aliases: ['JT', 'James', 'James Thomas', 'Jay Tee', 'Jay T'],
    role: 'member',
    ingestionStatus: 'pending',
  },
  // A clearly fictional member for exercising the blocked path. Deliberately
  // not related to anyone: group membership is not kinship.
  {
    key: 'testMember',
    fullName: 'Test Member',
    preferredName: 'Test Member',
    gender: null,
    aliases: ['Testy'],
    role: 'member',
    ingestionStatus: 'blocked',
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
  whatsappSenderMapped: boolean;
  /** Ingested messages destroyed by rebuilding the group. Seed data is
   *  idempotent; real messages and anything learned from them are not. */
  ingestedRowsRemoved: number;
}

/** The seeded group member a development WhatsApp sender is mapped to. */
const DEV_WHATSAPP_PERSON = 'jenna';

/**
 * Rebuilds the development household from scratch. Idempotent: running it twice
 * leaves the same data, so it is safe to re-run after schema changes.
 */
export async function seedWeekendCharlie(
  db: Db,
  options: { alexaUserId?: string | undefined; whatsappSenderId?: string | undefined } = {},
): Promise<SeedResult> {
  // Cascades through people, aliases, relationships, the Alexa mapping -- and
  // any ingested messages, extractions and events belonging to this group.
  const existing = await db.query(
    `SELECT count(*)::int AS count FROM group_message m
       JOIN household h ON h.id = m.household_id WHERE h.name = $1`,
    [HOUSEHOLD_NAME],
  );
  const ingestedRowsRemoved = (existing.rows[0]?.['count'] as number | undefined) ?? 0;

  await db.query('DELETE FROM household WHERE name = $1', [HOUSEHOLD_NAME]);

  const household = await db.query(
    'INSERT INTO household (name, timezone) VALUES ($1, $2) RETURNING id',
    [HOUSEHOLD_NAME, HOUSEHOLD_TIMEZONE],
  );
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

    await db.query(
      `INSERT INTO group_membership (household_id, person_id, role, ingestion_status)
       VALUES ($1, $2, $3, $4)`,
      [householdId, personId, person.role, person.ingestionStatus],
    );
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

  // Deleting the household cascades to person_contact, so this is rebuilt too.
  const whatsappSenderId = options.whatsappSenderId
    ? normalizePhoneIdentity(options.whatsappSenderId)
    : undefined;

  if (whatsappSenderId) {
    await db.query(
      `INSERT INTO person_contact (person_id, channel, external_id) VALUES ($1, 'whatsapp', $2)`,
      [personIds.get(DEV_WHATSAPP_PERSON), whatsappSenderId],
    );
  }

  return {
    householdId,
    alexaUserMapped: Boolean(options.alexaUserId),
    whatsappSenderMapped: Boolean(whatsappSenderId),
    ingestedRowsRemoved,
  };
}

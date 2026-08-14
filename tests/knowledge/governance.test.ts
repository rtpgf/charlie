import { describe, expect, it } from 'vitest';

import type { Db } from '../../src/db/index.js';
import {
  findMembership,
  NotAuthorizedError,
  setMemberIngestionStatus,
} from '../../src/group/membership.js';
import { findPeopleByName } from '../../src/group/graph.js';
import { loadGroupGraph } from '../../src/group/repository.js';
import { ingestInboundMessage } from '../../src/messaging/service.js';
import { parseWhatsAppWebhook } from '../../src/messaging/whatsapp/parse.js';
import { createSeededTestDb } from '../helpers/db.js';
import { stubExtractor } from '../helpers/extractor.js';
import { recordingMessenger, textMessageWebhook, JENNA_WHATSAPP_ID } from '../helpers/whatsapp.js';

const BLOCKED_WHATSAPP_ID = '12145550999';

async function seeded() {
  const { db, householdId } = await createSeededTestDb({ whatsappSenderId: JENNA_WHATSAPP_ID });
  const graph = await loadGroupGraph(db, householdId);
  const person = (name: string) => findPeopleByName(graph, name)[0]!;
  return { db, householdId, person };
}

/** Gives the blocked seed member a messaging identity so they can send. */
async function giveTestMemberAContact(db: Db, personId: string) {
  await db.query(
    `INSERT INTO person_contact (person_id, channel, external_id) VALUES ($1, 'whatsapp', $2)`,
    [personId, BLOCKED_WHATSAPP_ID],
  );
}

describe('membership and roles', () => {
  it('seeds Jenna as an admin who may be learned from', async () => {
    const { db, householdId, person } = await seeded();

    const membership = await findMembership(db, householdId, person('Jenna').id);

    expect(membership).toMatchObject({ role: 'admin', ingestionStatus: 'allowed' });
  });

  it('seeds ordinary members without admin rights', async () => {
    const { db, householdId, person } = await seeded();

    const membership = await findMembership(db, householdId, person('Hannah').id);

    expect(membership).toMatchObject({ role: 'member', ingestionStatus: 'allowed' });
  });

  it('seeds a blocked test member', async () => {
    const { db, householdId, person } = await seeded();

    const membership = await findMembership(db, householdId, person('Test Member').id);

    expect(membership).toMatchObject({ role: 'member', ingestionStatus: 'blocked' });
  });

  it('defaults people who have not opted in to pending', async () => {
    const { db, householdId, person } = await seeded();

    const membership = await findMembership(db, householdId, person('Natalie').id);

    expect(membership?.ingestionStatus).toBe('pending');
  });
});

describe('admin authority over ingestion status', () => {
  it('lets an admin block a member', async () => {
    const { db, householdId, person } = await seeded();
    const target = (await findMembership(db, householdId, person('Hannah').id))!;

    const updated = await setMemberIngestionStatus(db, {
      actingPersonId: person('Jenna').id,
      targetMembershipId: target.id,
      status: 'blocked',
    });

    expect(updated.ingestionStatus).toBe('blocked');
  });

  it('lets an admin unblock a member', async () => {
    const { db, householdId, person } = await seeded();
    const target = (await findMembership(db, householdId, person('Test Member').id))!;

    const updated = await setMemberIngestionStatus(db, {
      actingPersonId: person('Jenna').id,
      targetMembershipId: target.id,
      status: 'allowed',
    });

    expect(updated.ingestionStatus).toBe('allowed');
  });

  it('refuses an ordinary member', async () => {
    const { db, householdId, person } = await seeded();
    const target = (await findMembership(db, householdId, person('Test Member').id))!;

    await expect(
      setMemberIngestionStatus(db, {
        actingPersonId: person('Hannah').id,
        targetMembershipId: target.id,
        status: 'allowed',
      }),
    ).rejects.toThrow(NotAuthorizedError);
  });

  it('refuses a member trying to unblock themselves', async () => {
    const { db, householdId, person } = await seeded();
    const target = (await findMembership(db, householdId, person('Test Member').id))!;

    await expect(
      setMemberIngestionStatus(db, {
        actingPersonId: person('Test Member').id,
        targetMembershipId: target.id,
        status: 'allowed',
      }),
    ).rejects.toThrow(NotAuthorizedError);

    const unchanged = await findMembership(db, householdId, person('Test Member').id);
    expect(unchanged?.ingestionStatus).toBe('blocked');
  });
});

describe('blocked senders', () => {
  it('never reaches the knowledge extractor', async () => {
    const { db, person } = await seeded();
    await giveTestMemberAContact(db, person('Test Member').id);
    const extractor = stubExtractor();
    const messenger = recordingMessenger();

    const [message] = parseWhatsAppWebhook(
      textMessageWebhook({ from: BLOCKED_WHATSAPP_ID, body: 'Dinner tomorrow at seven.' }),
    );
    const outcome = await ingestInboundMessage(message!, { db, messenger, extractor });

    expect(outcome).toBe('ingestion_denied');
    expect(extractor.calls).toEqual([]);
  });

  it('does not store the message as group content', async () => {
    const { db, person } = await seeded();
    await giveTestMemberAContact(db, person('Test Member').id);

    const [message] = parseWhatsAppWebhook(
      textMessageWebhook({ from: BLOCKED_WHATSAPP_ID, body: 'Dinner tomorrow at seven.' }),
    );
    await ingestInboundMessage(message!, { db, extractor: stubExtractor() });

    const stored = await db.query('SELECT count(*)::int AS count FROM group_message');
    const events = await db.query('SELECT count(*)::int AS count FROM group_event');
    expect(stored.rows[0]!['count']).toBe(0);
    expect(events.rows[0]!['count']).toBe(0);
  });

  it('cannot become allowed merely by sending messages', async () => {
    const { db, householdId, person } = await seeded();
    await giveTestMemberAContact(db, person('Test Member').id);

    for (let i = 0; i < 3; i += 1) {
      const [message] = parseWhatsAppWebhook(
        textMessageWebhook({ from: BLOCKED_WHATSAPP_ID, messageId: `wamid.LOOP-${i}` }),
      );
      await ingestInboundMessage(message!, { db, extractor: stubExtractor() });
    }

    const membership = await findMembership(db, householdId, person('Test Member').id);
    expect(membership?.ingestionStatus).toBe('blocked');
  });

  it('treats pending the same way operationally', async () => {
    const { db, householdId, person } = await seeded();
    const natalie = person('Natalie').id;
    await db.query(
      `INSERT INTO person_contact (person_id, channel, external_id) VALUES ($1, 'whatsapp', '12145550777')`,
      [natalie],
    );
    const extractor = stubExtractor();

    const [message] = parseWhatsAppWebhook(textMessageWebhook({ from: '12145550777' }));
    const outcome = await ingestInboundMessage(message!, { db, extractor });

    expect(outcome).toBe('ingestion_denied');
    expect(extractor.calls).toEqual([]);
    // Still distinct from blocked in the data, for a future onboarding flow.
    const membership = await findMembership(db, householdId, natalie);
    expect(membership?.ingestionStatus).toBe('pending');
  });
});

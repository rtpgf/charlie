import { describe, expect, it } from 'vitest';

import type { Db } from '../../src/db/index.js';
import { ingestInboundMessage } from '../../src/messaging/service.js';
import type { InboundGroupMessage } from '../../src/messaging/types.js';
import { parseWhatsAppWebhook } from '../../src/messaging/whatsapp/parse.js';
import { createSeededTestDb } from '../helpers/db.js';
import {
  failingMessenger,
  imageMessageWebhook,
  recordingMessenger,
  textMessageWebhook,
  JENNA_WHATSAPP_ID,
  STRANGER_WHATSAPP_ID,
} from '../helpers/whatsapp.js';

const ORIGINAL_TEXT = "I'm coming over tomorrow around three.";

async function seeded() {
  return createSeededTestDb({ whatsappSenderId: JENNA_WHATSAPP_ID });
}

function messageFrom(webhook: unknown): InboundGroupMessage {
  const [message] = parseWhatsAppWebhook(webhook);
  if (!message) throw new Error('fixture produced no message');
  return message;
}

async function storedMessages(db: Db) {
  const result = await db.query(
    `SELECT m.body, m.channel, m.external_message_id, m.sender_external_id,
            m.household_id, m.provider_received_at, p.preferred_name AS sender
       FROM group_message m JOIN person p ON p.id = m.sender_person_id`,
  );
  return result.rows;
}

describe('ingesting a recognized text message', () => {
  it('stores it with the correct household, sender, channel and provenance', async () => {
    const { db, householdId } = await seeded();
    const messenger = recordingMessenger();

    const outcome = await ingestInboundMessage(messageFrom(textMessageWebhook()), {
      db,
      messenger,
    });

    expect(outcome).toBe('stored');

    const rows = await storedMessages(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      body: ORIGINAL_TEXT,
      channel: 'whatsapp',
      external_message_id: 'wamid.TEST-MESSAGE-1',
      sender_external_id: JENNA_WHATSAPP_ID,
      household_id: householdId,
      sender: 'Jenna',
    });
    expect(rows[0]!['provider_received_at']).toBeInstanceOf(Date);
  });

  it('preserves the original text exactly, including punctuation and case', async () => {
    const { db } = await seeded();
    const original = "Jenna is coming over tomorrow at THREE -- don't forget! 🙂";

    await ingestInboundMessage(messageFrom(textMessageWebhook({ body: original })), { db });

    const rows = await storedMessages(db);
    expect(rows[0]!['body']).toBe(original);
  });

  it('acknowledges by reacting to the message rather than replying', async () => {
    const { db } = await seeded();
    const messenger = recordingMessenger();
    const message = messageFrom(textMessageWebhook());

    await ingestInboundMessage(message, { db, messenger });

    expect(messenger.reactions).toEqual([
      { to: JENNA_WHATSAPP_ID, messageId: message.externalMessageId, emoji: '\u{1F44D}' },
    ]);
    // The family thread stays free of bot chatter.
    expect(messenger.sent).toEqual([]);
  });

  it('falls back to a reply when the provider will not accept a reaction', async () => {
    const { db } = await seeded();
    const { reactionUnsupportedMessenger } = await import('../helpers/whatsapp.js');
    const messenger = reactionUnsupportedMessenger();

    await ingestInboundMessage(messageFrom(textMessageWebhook()), { db, messenger });

    // Silence would be indistinguishable from Charlie being broken.
    expect(messenger.sent).toEqual([
      { to: JENNA_WHATSAPP_ID, text: "Got it. I've saved your message." },
    ]);
  });
});

describe('duplicate provider delivery', () => {
  it('stores the message exactly once', async () => {
    const { db } = await seeded();
    const message = messageFrom(textMessageWebhook());

    const first = await ingestInboundMessage(message, { db });
    const second = await ingestInboundMessage(message, { db });

    expect(first).toBe('stored');
    expect(second).toBe('duplicate');
    expect(await storedMessages(db)).toHaveLength(1);
  });

  it('does not acknowledge a redelivery twice', async () => {
    const { db } = await seeded();
    const messenger = recordingMessenger();
    const message = messageFrom(textMessageWebhook());

    await ingestInboundMessage(message, { db, messenger });
    await ingestInboundMessage(message, { db, messenger });

    expect(messenger.reactions).toHaveLength(1);
  });

  it('treats a different provider message id as a new message', async () => {
    const { db } = await seeded();

    await ingestInboundMessage(messageFrom(textMessageWebhook()), { db });
    await ingestInboundMessage(
      messageFrom(textMessageWebhook({ messageId: 'wamid.TEST-MESSAGE-2' })),
      { db },
    );

    expect(await storedMessages(db)).toHaveLength(2);
  });
});

describe('unknown sender', () => {
  it('does not store the message', async () => {
    const { db } = await seeded();

    const outcome = await ingestInboundMessage(
      messageFrom(textMessageWebhook({ from: STRANGER_WHATSAPP_ID })),
      { db },
    );

    expect(outcome).toBe('unknown_sender');
    expect(await storedMessages(db)).toHaveLength(0);
  });

  it('does not create a person or contact for them', async () => {
    const { db } = await seeded();

    await ingestInboundMessage(messageFrom(textMessageWebhook({ from: STRANGER_WHATSAPP_ID })), {
      db,
    });

    const people = await db.query('SELECT count(*)::int AS count FROM person');
    const contacts = await db.query('SELECT count(*)::int AS count FROM person_contact');
    expect(people.rows[0]!['count']).toBe(5);
    expect(contacts.rows[0]!['count']).toBe(1);
  });

  it('does not reply to them', async () => {
    const { db } = await seeded();
    const messenger = recordingMessenger();

    await ingestInboundMessage(messageFrom(textMessageWebhook({ from: STRANGER_WHATSAPP_ID })), {
      db,
      messenger,
    });

    expect(messenger.sent).toEqual([]);
    expect(messenger.reactions).toEqual([]);
  });
});

describe('media messages', () => {
  it('stores a photo message, which Milestone 3 could not', async () => {
    const { db } = await seeded();

    // No media deps configured here, so retrieval cannot succeed -- but the
    // message is authorized and stored exactly like any other.
    const outcome = await ingestInboundMessage(messageFrom(imageMessageWebhook()), { db });

    expect(outcome).toBe('stored');
    expect(await storedMessages(db)).toHaveLength(1);
  });

  it('ignores a message carrying neither text nor media', async () => {
    const { db } = await seeded();
    const messenger = recordingMessenger();
    const contentless = { ...messageFrom(textMessageWebhook()), text: undefined, media: [] };

    const outcome = await ingestInboundMessage(contentless, { db, messenger });

    expect(outcome).toBe('unsupported_content');
    expect(await storedMessages(db)).toHaveLength(0);
    expect(messenger.reactions).toEqual([]);
  });
});

describe('failure handling', () => {
  it('keeps the stored message when acknowledgement fails', async () => {
    const { db } = await seeded();

    const outcome = await ingestInboundMessage(messageFrom(textMessageWebhook()), {
      db,
      messenger: failingMessenger(),
    });

    expect(outcome).toBe('stored');
    expect(await storedMessages(db)).toHaveLength(1);
  });

  it('does not claim success when the database is unavailable', async () => {
    const brokenDb: Db = {
      query: () => Promise.reject(new Error('connect ECONNREFUSED')),
    };
    const messenger = recordingMessenger();

    const outcome = await ingestInboundMessage(messageFrom(textMessageWebhook()), {
      db: brokenDb,
      messenger,
    });

    expect(outcome).toBe('storage_failed');
    // A warning mark, not a sentence: during an outage every message from every
    // person fails, and a reply each would fill the thread with bot noise.
    expect(messenger.reactions).toEqual([
      { to: JENNA_WHATSAPP_ID, messageId: 'wamid.TEST-MESSAGE-1', emoji: '\u{26A0}\u{FE0F}' },
    ]);
    expect(messenger.sent).toEqual([]);
  });

  it('never falls back to text when a failure reaction cannot be delivered', async () => {
    const brokenDb: Db = { query: () => Promise.reject(new Error('connect ECONNREFUSED')) };
    const { reactionUnsupportedMessenger } = await import('../helpers/whatsapp.js');
    const messenger = reactionUnsupportedMessenger();

    await ingestInboundMessage(messageFrom(textMessageWebhook()), { db: brokenDb, messenger });

    // Silence is the quieter failure here -- the diagnostic is in the logs.
    expect(messenger.sent).toEqual([]);
  });
});

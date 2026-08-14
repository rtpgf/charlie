import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import type { Db } from '../../src/db/index.js';
import { createServer } from '../../src/server.js';
import { createSeededTestDb } from '../helpers/db.js';
import {
  recordingMessenger,
  signBody,
  statusWebhook,
  textMessageWebhook,
  JENNA_WHATSAPP_ID,
  STRANGER_WHATSAPP_ID,
  TEST_VERIFY_TOKEN,
  type RecordingMessenger,
} from '../helpers/whatsapp.js';

let db: Db;
let messenger: RecordingMessenger;

beforeEach(async () => {
  ({ db } = await createSeededTestDb({ whatsappSenderId: JENNA_WHATSAPP_ID }));
  messenger = recordingMessenger();
});

function app() {
  return createServer({ db, messenger });
}

/** Posts a body signed the way Meta signs it. */
function postSigned(payload: unknown, options: { signature?: string } = {}) {
  const rawBody = JSON.stringify(payload);
  const req = request(app())
    .post('/webhooks/whatsapp')
    .set('Content-Type', 'application/json');

  const signature = 'signature' in options ? options.signature : signBody(rawBody);
  if (signature !== undefined) req.set('X-Hub-Signature-256', signature);

  return req.send(rawBody);
}

describe('GET /webhooks/whatsapp', () => {
  it('echoes the challenge for a correct verify token', async () => {
    const response = await request(app()).get('/webhooks/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': TEST_VERIFY_TOKEN,
      'hub.challenge': '1158201444',
    });

    expect(response.status).toBe(200);
    expect(response.text).toBe('1158201444');
  });

  it('rejects an incorrect verify token', async () => {
    const response = await request(app()).get('/webhooks/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong',
      'hub.challenge': '1158201444',
    });

    expect(response.status).toBe(403);
    expect(response.text).not.toContain('1158201444');
  });
});

describe('POST /webhooks/whatsapp', () => {
  it('accepts and stores a correctly signed message', async () => {
    const response = await postSigned(textMessageWebhook());

    expect(response.status).toBe(200);

    const rows = await db.query('SELECT body FROM group_message');
    expect(rows.rows).toHaveLength(1);
    expect(messenger.sent).toHaveLength(1);
  });

  it('rejects an unsigned request', async () => {
    const response = await postSigned(textMessageWebhook(), { signature: undefined });

    expect(response.status).toBe(403);
    const rows = await db.query('SELECT body FROM group_message');
    expect(rows.rows).toHaveLength(0);
  });

  it('rejects a request signed with the wrong secret', async () => {
    const rawBody = JSON.stringify(textMessageWebhook());
    const response = await postSigned(textMessageWebhook(), {
      signature: signBody(rawBody, 'attacker-secret'),
    });

    expect(response.status).toBe(403);
  });

  it('rejects a body altered after signing', async () => {
    const original = JSON.stringify(textMessageWebhook());
    const tampered = original.replace('three', 'four');

    const response = await request(app())
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signBody(original))
      .send(tampered);

    expect(response.status).toBe(403);
  });

  it('acknowledges a status callback without storing anything', async () => {
    const response = await postSigned(statusWebhook());

    expect(response.status).toBe(200);
    const rows = await db.query('SELECT body FROM group_message');
    expect(rows.rows).toHaveLength(0);
  });

  it('acknowledges a message from an unknown sender without storing it', async () => {
    const response = await postSigned(textMessageWebhook({ from: STRANGER_WHATSAPP_ID }));

    // 200 so Meta stops retrying; the message is deliberately dropped.
    expect(response.status).toBe(200);
    const rows = await db.query('SELECT body FROM group_message');
    expect(rows.rows).toHaveLength(0);
    expect(messenger.sent).toEqual([]);
  });

  it('is idempotent across a redelivered webhook', async () => {
    await postSigned(textMessageWebhook());
    const second = await postSigned(textMessageWebhook());

    expect(second.status).toBe(200);
    const rows = await db.query('SELECT body FROM group_message');
    expect(rows.rows).toHaveLength(1);
    expect(messenger.sent).toHaveLength(1);
  });
});

describe('the Alexa endpoint is unaffected', () => {
  it('still answers the health check', async () => {
    const response = await request(app()).get('/health');

    expect(response.body).toEqual({ status: 'ok', service: 'weekend-charlie' });
  });
});

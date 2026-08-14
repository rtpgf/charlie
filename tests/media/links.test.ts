import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import type { Db } from '../../src/db/index.js';
import { signMediaToken, verifyMediaToken } from '../../src/media/link.js';
import { createMediaRouter } from '../../src/media/router.js';
import { ingestInboundMessage } from '../../src/messaging/service.js';
import { parseWhatsAppWebhook } from '../../src/messaging/whatsapp/parse.js';
import { createSeededTestDb } from '../helpers/db.js';
import {
  imageWebhook,
  recordingAnalyzer,
  recordingFetcher,
  recordingStore,
  type RecordingStore,
} from '../helpers/media.js';
import { JENNA_WHATSAPP_ID } from '../helpers/whatsapp.js';
import express from 'express';

const SECRET = 'a-long-random-secret-for-tests';
const MEDIA_ID = '11111111-2222-3333-4444-555555555555';

function inAnHour(): Date {
  return new Date(Date.now() + 60 * 60 * 1000);
}

describe('signing a photo link', () => {
  it('round-trips the media id', () => {
    const token = signMediaToken({ mediaId: MEDIA_ID, expiresAt: inAnHour(), secret: SECRET });

    expect(verifyMediaToken({ token, secret: SECRET, now: new Date() })).toBe(MEDIA_ID);
  });

  it('stays far shorter than the storage URL an Echo Show would not load', () => {
    const token = signMediaToken({ mediaId: MEDIA_ID, expiresAt: inAnHour(), secret: SECRET });

    // The Supabase signed URL that failed on the device was 550 characters.
    expect(`https://charlie.example/media/${token}`.length).toBeLessThan(150);
  });

  it('carries nothing about the family', () => {
    const token = signMediaToken({ mediaId: MEDIA_ID, expiresAt: inAnHour(), secret: SECRET });

    // No household, no person, no file name, no caption -- just an opaque id.
    expect(token).not.toContain('groups/');
    expect(token.split('.')[0]).toBe(MEDIA_ID.replace(/-/g, ''));
  });

  it('refuses a token signed with a different secret', () => {
    const token = signMediaToken({ mediaId: MEDIA_ID, expiresAt: inAnHour(), secret: 'other' });

    expect(verifyMediaToken({ token, secret: SECRET, now: new Date() })).toBeNull();
  });

  it('refuses a tampered media id', () => {
    const token = signMediaToken({ mediaId: MEDIA_ID, expiresAt: inAnHour(), secret: SECRET });
    const [, expiry, signature] = token.split('.') as [string, string, string];
    const swapped = `${'9'.repeat(32)}.${expiry}.${signature}`;

    expect(verifyMediaToken({ token: swapped, secret: SECRET, now: new Date() })).toBeNull();
  });

  it('refuses an extended expiry', () => {
    const token = signMediaToken({ mediaId: MEDIA_ID, expiresAt: inAnHour(), secret: SECRET });
    const [id, , signature] = token.split('.') as [string, string, string];
    const later = Math.floor(Date.now() / 1000 + 999999).toString(36);

    expect(verifyMediaToken({ token: `${id}.${later}.${signature}`, secret: SECRET, now: new Date() }))
      .toBeNull();
  });

  it('refuses a token that has expired', () => {
    const token = signMediaToken({
      mediaId: MEDIA_ID,
      expiresAt: new Date(Date.now() - 1000),
      secret: SECRET,
    });

    expect(verifyMediaToken({ token, secret: SECRET, now: new Date() })).toBeNull();
  });

  it('refuses malformed tokens without throwing', () => {
    for (const token of ['', 'nonsense', 'a.b', 'a.b.c.d', '../../etc/passwd']) {
      expect(verifyMediaToken({ token, secret: SECRET, now: new Date() })).toBeNull();
    }
  });
});

describe('serving a photo', () => {
  let db: Db;
  let store: RecordingStore;
  let mediaId: string;

  beforeEach(async () => {
    ({ db } = await createSeededTestDb({ whatsappSenderId: JENNA_WHATSAPP_ID }));
    store = recordingStore();
    const [message] = parseWhatsAppWebhook(imageWebhook({ mediaId: 'm1', messageId: 'wamid.1' }));
    await ingestInboundMessage(message!, {
      db,
      media: { fetcher: recordingFetcher(), store, analyzer: recordingAnalyzer() },
    });
    const stored = await db.query(`SELECT id FROM group_media WHERE status = 'stored'`);
    mediaId = stored.rows[0]!['id'] as string;
  });

  /** `secret` is passed through as given -- omitting it is not the same as
   *  passing undefined, which is exactly what one of these tests checks. */
  function serve(options: { secret?: string | undefined } = { secret: SECRET }) {
    const app = express();
    app.use('/media', createMediaRouter({ db, store, secret: options.secret }));
    return app;
  }

  it('returns the photo for a valid token', async () => {
    const token = signMediaToken({ mediaId, expiresAt: inAnHour(), secret: SECRET });

    const response = await request(serve()).get(`/media/${token}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/');
    expect(response.body.length).toBeGreaterThan(0);
  });

  it('never lets a shared cache keep it', async () => {
    const token = signMediaToken({ mediaId, expiresAt: inAnHour(), secret: SECRET });

    const response = await request(serve()).get(`/media/${token}`);

    // The token is the credential, so the photo must not outlive it in a proxy.
    expect(response.headers['cache-control']).toContain('private');
  });

  it('refuses an expired token', async () => {
    const token = signMediaToken({
      mediaId,
      expiresAt: new Date(Date.now() - 1000),
      secret: SECRET,
    });

    expect((await request(serve()).get(`/media/${token}`)).status).toBe(404);
  });

  it('refuses a forged token', async () => {
    const token = signMediaToken({ mediaId, expiresAt: inAnHour(), secret: 'guessed' });

    expect((await request(serve()).get(`/media/${token}`)).status).toBe(404);
  });

  it('answers the same way for a photo that does not exist', async () => {
    const token = signMediaToken({ mediaId: MEDIA_ID, expiresAt: inAnHour(), secret: SECRET });

    // Indistinguishable from a forged token: the caller learns nothing about
    // which photos exist.
    expect((await request(serve()).get(`/media/${token}`)).status).toBe(404);
  });

  it('serves nothing at all when no signing secret is configured', async () => {
    const token = signMediaToken({ mediaId, expiresAt: inAnHour(), secret: SECRET });

    expect((await request(serve({})).get(`/media/${token}`)).status).toBe(404);
  });
});

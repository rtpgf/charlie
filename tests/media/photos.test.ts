import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import type { Db } from '../../src/db/index.js';
import { ingestInboundMessage } from '../../src/messaging/service.js';
import { parseWhatsAppWebhook } from '../../src/messaging/whatsapp/parse.js';
import { createServer } from '../../src/server.js';
import { createSeededTestDb } from '../helpers/db.js';
import { intentRequest, TEST_ALEXA_USER_ID } from '../fixtures.js';
import {
  failingStore,
  imageWebhook,
  recordingAnalyzer,
  recordingFetcher,
  recordingStore,
  type RecordingStore,
} from '../helpers/media.js';
import { JENNA_WHATSAPP_ID } from '../helpers/whatsapp.js';

let db: Db;
let store: RecordingStore;

beforeEach(async () => {
  ({ db } = await createSeededTestDb({
    alexaUserId: TEST_ALEXA_USER_ID,
    whatsappSenderId: JENNA_WHATSAPP_ID,
  }));
  store = recordingStore();
});

/** Sends `count` photos as one share, the way WhatsApp delivers them. */
async function sharePhotos(count: number, caption?: string) {
  for (let index = 0; index < count; index += 1) {
    const [message] = parseWhatsAppWebhook(
      imageWebhook({
        mediaId: `m${index}`,
        messageId: `wamid.${index}`,
        caption: index === 0 ? caption : undefined,
        timestamp: String(1786600000 + index),
      }),
    );
    await ingestInboundMessage(message!, {
      db,
      media: { fetcher: recordingFetcher(), store, analyzer: recordingAnalyzer() },
    });
  }
}

/** An envelope from a device with a screen, or without one. */
function ask(intent: string, options: { screen: boolean; session?: Record<string, unknown> }) {
  const envelope = intentRequest(intent) as Record<string, unknown>;
  const context = envelope['context'] as { System: Record<string, unknown> };
  context.System['device'] = {
    deviceId: 'test-device',
    supportedInterfaces: options.screen ? { 'Alexa.Presentation.APL': {} } : {},
  };
  if (options.session) {
    (envelope['session'] as Record<string, unknown>)['attributes'] = options.session;
  }
  return request(createServer({ db, store, extractor: undefined }))
    .post('/alexa')
    .send(envelope)
    .set('Content-Type', 'application/json');
}

function spoken(response: { body: { response: { outputSpeech?: { ssml?: string } } } }): string {
  return (response.body.response.outputSpeech?.ssml ?? '')
    .replace(/^<speak>/, '')
    .replace(/<\/speak>$/, '');
}

function directives(response: { body: { response: { directives?: unknown[] } } }): unknown[] {
  return response.body.response.directives ?? [];
}

describe('showing the latest pictures', () => {
  it('renders the first photo on a device with a screen', async () => {
    await sharePhotos(3, "Here's Natalie at the beach!");

    const response = await ask('ShowLatestPicturesIntent', { screen: true });

    expect(response.status).toBe(200);
    const directive = directives(response)[0] as Record<string, unknown>;
    expect(directive['type']).toBe('Alexa.Presentation.APL.RenderDocument');
    expect(spoken(response)).toContain('Jenna sent these');
    expect(spoken(response)).toContain('Natalie at the beach');
  });

  it('shows the photo through a time-limited URL, never a public one', async () => {
    await sharePhotos(1);

    await ask('ShowLatestPicturesIntent', { screen: true });

    expect(store.signed).toHaveLength(1);
    expect(store.signed[0]!.expiresIn).toBeGreaterThan(0);
    expect(store.signed[0]!.expiresIn).toBeLessThanOrEqual(60 * 60);
  });

  it('never puts a signed URL into the spoken response', async () => {
    await sharePhotos(1);

    const response = await ask('ShowLatestPicturesIntent', { screen: true });

    expect(spoken(response)).not.toContain('http');
    expect(spoken(response)).not.toContain('token');
  });

  it('stays useful on a device with no screen', async () => {
    await sharePhotos(6, "Here's Natalie at the beach!");

    const response = await ask('ShowLatestPicturesIntent', { screen: false });

    // Leads with how many, because the words are all there is.
    expect(spoken(response)).toContain('6 pictures');
    expect(spoken(response)).toContain('Jenna sent');
    expect(directives(response)).toEqual([]);
    // Never a dead end about the device not supporting pictures.
    expect(spoken(response).toLowerCase()).not.toContain('support');
  });

  it('says so when there are no pictures yet', async () => {
    const response = await ask('ShowLatestPicturesIntent', { screen: true });

    expect(spoken(response)).toContain("don't have any pictures");
    expect(directives(response)).toEqual([]);
  });

  it('speaks rather than exposing a fallback URL when signing fails', async () => {
    await sharePhotos(1);
    const broken = createServer({ db, store: failingStore(), extractor: undefined });
    const envelope = intentRequest('ShowLatestPicturesIntent') as Record<string, unknown>;
    (envelope['context'] as { System: Record<string, unknown> }).System['device'] = {
      deviceId: 'test-device',
      supportedInterfaces: { 'Alexa.Presentation.APL': {} },
    };

    const response = await request(broken)
      .post('/alexa')
      .send(envelope)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(spoken(response)).toContain('having trouble showing');
    expect(directives(response)).toEqual([]);
  });
});

describe('navigating a share', () => {
  it('moves to the next photo', async () => {
    await sharePhotos(3);
    const first = await ask('ShowLatestPicturesIntent', { screen: true });
    const session = first.body.sessionAttributes as Record<string, unknown>;

    const next = await ask('AMAZON.NextIntent', { screen: true, session });

    expect(next.body.sessionAttributes['photoIndex']).toBe(1);
    expect(directives(next)).toHaveLength(1);
  });

  it('moves back to the previous photo', async () => {
    await sharePhotos(3);
    const first = await ask('ShowLatestPicturesIntent', { screen: true });
    const next = await ask('AMAZON.NextIntent', {
      screen: true,
      session: first.body.sessionAttributes,
    });

    const back = await ask('AMAZON.PreviousIntent', {
      screen: true,
      session: next.body.sessionAttributes,
    });

    expect(back.body.sessionAttributes['photoIndex']).toBe(0);
  });

  it('says when it reaches the end rather than wrapping', async () => {
    await sharePhotos(2);
    const first = await ask('ShowLatestPicturesIntent', { screen: true });
    const second = await ask('AMAZON.NextIntent', {
      screen: true,
      session: first.body.sessionAttributes,
    });

    const past = await ask('AMAZON.NextIntent', {
      screen: true,
      session: second.body.sessionAttributes,
    });

    expect(spoken(past)).toBe("That's the last one.");
  });

  it('asks the user to start again when nothing is in view', async () => {
    await sharePhotos(1);

    const response = await ask('AMAZON.NextIntent', { screen: true });

    expect(spoken(response)).toContain('latest pictures');
  });
});

describe('asking about what is showing', () => {
  it('answers who sent them', async () => {
    await sharePhotos(2);
    const first = await ask('ShowLatestPicturesIntent', { screen: true });

    const response = await ask('WhoSentThisIntent', {
      screen: true,
      session: first.body.sessionAttributes,
    });

    expect(spoken(response)).toBe('Jenna sent them.');
  });

  it('answers when they were shared', async () => {
    await sharePhotos(1);
    const first = await ask('ShowLatestPicturesIntent', { screen: true });

    const response = await ask('WhenWasThisSharedIntent', {
      screen: true,
      session: first.body.sessionAttributes,
    });

    expect(spoken(response)).toMatch(/Jenna sent it (today|yesterday|on )/);
  });
});

describe('regressions', () => {
  it('leaves the database-unavailable behaviour intact', async () => {
    const brokenDb: Db = { query: () => Promise.reject(new Error('connect ECONNREFUSED')) };
    const envelope = intentRequest('ShowLatestPicturesIntent');

    const response = await request(createServer({ db: brokenDb, store, extractor: undefined }))
      .post('/alexa')
      .send(envelope)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(spoken(response)).toContain('having trouble remembering');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { APL_DOCUMENT_VERSION, photoDocument } from '../../src/alexa/apl.js';
import type { Db } from '../../src/db/index.js';
import { ingestInboundMessage } from '../../src/messaging/service.js';
import { parseWhatsAppWebhook } from '../../src/messaging/whatsapp/parse.js';
import { createServer } from '../../src/server.js';
import { createSeededTestDb } from '../helpers/db.js';
import { intentRequest, spokenFrom, TEST_ALEXA_USER_ID } from '../fixtures.js';
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
  return spokenFrom(response.body.response.outputSpeech?.ssml);
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
    // The photo the device will actually fetch must be in what we send it.
    const document = JSON.stringify(directive['document']);
    expect(document).toContain(encodeURIComponent(store.signed[0]!.key));
    expect(document).toContain('https://');
    expect(spoken(response)).toContain('Jenna sent these');
    expect(spoken(response)).toContain('Natalie at the beach');
  });

  it('serves the photo from Charlie\'s own domain when one is configured', async () => {
    await sharePhotos(1);
    const envelope = intentRequest('ShowLatestPicturesIntent') as Record<string, unknown>;
    (envelope['context'] as { System: Record<string, unknown> }).System['device'] = {
      deviceId: 'test-device',
      supportedInterfaces: { 'Alexa.Presentation.APL': {} },
    };

    const response = await request(
      createServer({
        db,
        store,
        extractor: undefined,
        link: { baseUrl: 'https://charlie.example', secret: 'a-long-test-secret' },
      }),
    )
      .post('/alexa')
      .send(envelope)
      .set('Content-Type', 'application/json');

    const directive = directives(response)[0] as Record<string, unknown>;
    const source = JSON.stringify(directive['document']);
    // An Echo Show will not load a 550-character storage URL, so the document
    // points at Charlie, on the origin the device already reaches it through.
    expect(source).toContain('https://charlie.example/media/');
    expect(store.signed).toHaveLength(0);
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
  it('moves the stack on the device rather than rebuilding it', async () => {
    await sharePhotos(3);
    const first = await ask('ShowLatestPicturesIntent', { screen: true });
    const session = first.body.sessionAttributes as Record<string, unknown>;

    const next = await ask('AMAZON.NextIntent', { screen: true, session });

    const directive = directives(next)[0] as Record<string, unknown>;
    expect(directive['type']).toBe('Alexa.Presentation.APL.ExecuteCommands');
    const command = (directive['commands'] as Record<string, unknown>[])[0]!;
    expect(command['type']).toBe('SetPage');
    expect(command['value']).toBe(1);
  });

  it('moves relative to the page the device is showing, not a remembered index', async () => {
    await sharePhotos(3);
    const first = await ask('ShowLatestPicturesIntent', { screen: true });

    const next = await ask('AMAZON.NextIntent', {
      screen: true,
      session: first.body.sessionAttributes,
    });

    // Someone may have swiped between turns. Charlie must not assume it knows
    // which photo is on the screen -- the device does, so it decides.
    const command = ((directives(next)[0] as Record<string, unknown>)[
      'commands'
    ] as Record<string, unknown>[])[0]!;
    expect(command['position']).toBe('relative');
  });

  it('moves back the other way', async () => {
    await sharePhotos(3);
    const first = await ask('ShowLatestPicturesIntent', { screen: true });

    const back = await ask('AMAZON.PreviousIntent', {
      screen: true,
      session: first.body.sessionAttributes,
    });

    const command = ((directives(back)[0] as Record<string, unknown>)[
      'commands'
    ] as Record<string, unknown>[])[0]!;
    expect(command['value']).toBe(-1);
  });

  it('says nothing at all when moving a stack someone can see', async () => {
    await sharePhotos(3, "Here's Natalie at the beach!");
    const first = await ask('ShowLatestPicturesIntent', { screen: true });

    const next = await ask('AMAZON.NextIntent', {
      screen: true,
      session: first.body.sessionAttributes,
    });

    // The photo is the answer. Narrating every swipe would be noise, and the
    // vision description -- "a child in a purple swimsuit" -- read to a family
    // who know the child is a case file.
    expect(next.body.response.outputSpeech).toBeUndefined();
  });

  it('walks the share aloud when there is no screen to swipe', async () => {
    await sharePhotos(3);
    const first = await ask('ShowLatestPicturesIntent', { screen: false });

    const next = await ask('AMAZON.NextIntent', {
      screen: false,
      session: first.body.sessionAttributes,
    });

    expect(spoken(next)).toBe('2 of 3');
    expect(next.body.sessionAttributes['photoIndex']).toBe(1);
    expect(directives(next)).toEqual([]);
  });

  it('says when a screenless share runs out, rather than wrapping', async () => {
    await sharePhotos(2);
    const first = await ask('ShowLatestPicturesIntent', { screen: false });
    const second = await ask('AMAZON.NextIntent', {
      screen: false,
      session: first.body.sessionAttributes,
    });

    const past = await ask('AMAZON.NextIntent', {
      screen: false,
      session: second.body.sessionAttributes,
    });

    // A stack you can see wraps, because the position marker tells you where
    // you are. Spoken, looping silently would just be confusing.
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

describe('the photo document itself', () => {
  /** Every string value in the document, however deeply nested. */
  function strings(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
    return [];
  }

  const CAPTION = 'Jenna: Natalie at the beach!';

  /** A share of `count` photos, the way the handler builds one. */
  function stack(count: number, fit?: 'contain' | 'cover') {
    return {
      caption: CAPTION,
      ...(fit ? { fit } : {}),
      slides: Array.from({ length: count }, (_, index) => ({
        imageUrl: `https://example.test/media/photo${index}`,
        position: count > 1 ? `${index + 1} of ${count}` : undefined,
      })),
    };
  }

  it('references no resource the document does not define', () => {
    // An unresolved `@name` reaches the device as a literal string where a
    // dimension belongs, and the component fails to inflate -- a blank screen
    // with no error anywhere. Cost us an evening.
    const unresolved = strings(photoDocument(stack(2))).filter((v) => v.startsWith('@'));

    expect(unresolved).toEqual([]);
  });

  it('carries the photo and caption itself, with nothing left to resolve', () => {
    // A `${...}` binding that does not resolve renders as empty, which on a
    // device looks exactly like a photo that would not load. So there are none.
    const values = strings(photoDocument(stack(2)));

    expect(values).toContain('https://example.test/media/photo0');
    expect(values).toContain('https://example.test/media/photo1');
    expect(values).toContain(CAPTION);
    expect(values).toContain('1 of 2');
    expect(values.filter((value) => value.includes('${'))).toEqual([]);
  });

  it('honours the fit chosen for the request', async () => {
    await sharePhotos(2);
    const envelope = intentRequest('ShowLatestPicturesIntent') as Record<string, unknown>;
    (envelope['context'] as { System: Record<string, unknown> }).System['device'] = {
      deviceId: 'test-device',
      supportedInterfaces: { 'Alexa.Presentation.APL': {} },
    };

    const response = await request(
      createServer({ db, store, extractor: undefined, photoFit: 'contain' }),
    )
      .post('/alexa')
      .send(envelope)
      .set('Content-Type', 'application/json');

    const directive = (response.body.response.directives ?? [])[0] as Record<string, unknown>;
    expect(JSON.stringify(directive['document'])).toContain('best-fit');
  });

  it('leaves out the position marker for a single photo', () => {
    const values = strings(photoDocument(stack(1)));

    expect(values).toContain(CAPTION);
    expect(values).not.toContain('1 of 1');
  });

  it('fills the screen by default', () => {
    const values = strings(photoDocument(stack(2)));

    // A matted photo is honest to the framing and, on a small Echo Show, tiny:
    // a portrait photograph inside a landscape matte is a stamp in a field of
    // white. Big beats uncropped on a display someone glances at from a couch.
    expect(values).toContain('best-fill');
    expect(values).not.toContain('best-fit');
  });

  it('drifts slowly across the photograph', () => {
    const document = JSON.stringify(photoDocument(stack(2)));

    expect(document).toContain('"type":"AnimateItem"');
    expect(document).toContain('"property":"transform"');
    // Reversing, not restarting: a snap back to the start draws the eye to the
    // animation instead of the face.
    expect(document).toContain('"repeatMode":"reverse"');
  });

  it('holds still when motion is turned off', () => {
    const document = JSON.stringify(photoDocument({ ...stack(2), motion: false }));

    expect(document).not.toContain('AnimateItem');
  });

  it('mats the photo when asked to, and only then', () => {
    const matted = JSON.stringify(photoDocument(stack(2, 'contain')));
    const filled = JSON.stringify(photoDocument(stack(2, 'cover')));

    expect(matted).toContain('"type":"Frame"');
    expect(matted).toContain('best-fit');
    expect(filled).not.toContain('"type":"Frame"');
  });

  it('paints its own background in both presentations', () => {
    // A transparent screen borrows whatever the device is showing.
    for (const fit of ['contain', 'cover'] as const) {
      const document = JSON.stringify(photoDocument(stack(2, fit)));
      expect(document).toContain('#1C3B47');
    }
  });

  it('keeps the caption readable in both presentations', () => {
    for (const fit of ['contain', 'cover'] as const) {
      const values = strings(photoDocument(stack(2, fit)));
      expect(values).toContain(CAPTION);
      expect(values).toContain('1 of 2');
    }
  });

  it('puts every photo in the share on the device, so it can be swiped', () => {
    const document = JSON.stringify(photoDocument(stack(4)));

    expect(document).toContain('"type":"Pager"');
    for (let index = 0; index < 4; index += 1) {
      expect(document).toContain(`photo${index}`);
    }
  });

  it('wraps, so the top photo goes to the bottom of the stack', () => {
    expect(JSON.stringify(photoDocument(stack(3)))).toContain('"navigation":"wrap"');
  });

  it('does not offer to page through a single photograph', () => {
    expect(JSON.stringify(photoDocument(stack(1)))).toContain('"navigation":"none"');
  });

  it('writes each position inside its own page, so a swipe updates it', () => {
    // Nothing else knows which photo is showing -- not the server, not the
    // session. The page carries its own marker.
    const pager = JSON.stringify(photoDocument(stack(3)));

    for (const marker of ['1 of 3', '2 of 3', '3 of 3']) {
      expect(pager).toContain(marker);
    }
  });

  it('asks for no more APL than the components actually need', () => {
    // Older Echo Shows drop a document that demands a newer runtime.
    expect(Number(APL_DOCUMENT_VERSION)).toBeLessThanOrEqual(1.6);
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

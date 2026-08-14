import { describe, expect, it } from 'vitest';

import { parseWhatsAppWebhook } from '../../src/messaging/whatsapp/parse.js';
import { verifySignature, verifySubscription } from '../../src/messaging/whatsapp/verify.js';
import {
  imageMessageWebhook,
  signBody,
  statusWebhook,
  textMessageWebhook,
  TEST_APP_SECRET,
  TEST_VERIFY_TOKEN,
} from '../helpers/whatsapp.js';

describe('webhook subscription challenge', () => {
  it('echoes the challenge when the token matches', () => {
    const challenge = verifySubscription(
      {
        'hub.mode': 'subscribe',
        'hub.verify_token': TEST_VERIFY_TOKEN,
        'hub.challenge': '1158201444',
      },
      TEST_VERIFY_TOKEN,
    );

    expect(challenge).toBe('1158201444');
  });

  it('rejects an incorrect token', () => {
    const challenge = verifySubscription(
      {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': '1158201444',
      },
      TEST_VERIFY_TOKEN,
    );

    expect(challenge).toBeNull();
  });

  it('rejects a mode other than subscribe', () => {
    const challenge = verifySubscription(
      {
        'hub.mode': 'unsubscribe',
        'hub.verify_token': TEST_VERIFY_TOKEN,
        'hub.challenge': '1158201444',
      },
      TEST_VERIFY_TOKEN,
    );

    expect(challenge).toBeNull();
  });
});

describe('webhook signature', () => {
  const rawBody = JSON.stringify(textMessageWebhook());

  it('accepts a correctly signed body', () => {
    expect(verifySignature(rawBody, signBody(rawBody), TEST_APP_SECRET)).toBe(true);
  });

  it('rejects a body signed with the wrong secret', () => {
    expect(verifySignature(rawBody, signBody(rawBody, 'other-secret'), TEST_APP_SECRET)).toBe(
      false,
    );
  });

  it('rejects a tampered body', () => {
    const signature = signBody(rawBody);
    const tampered = rawBody.replace('three', 'four');

    expect(verifySignature(tampered, signature, TEST_APP_SECRET)).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(verifySignature(rawBody, undefined, TEST_APP_SECRET)).toBe(false);
  });

  it('rejects a signature without the sha256 prefix', () => {
    const bare = signBody(rawBody).replace('sha256=', '');

    expect(verifySignature(rawBody, bare, TEST_APP_SECRET)).toBe(false);
  });
});

describe('webhook parsing', () => {
  it('normalizes an inbound text message', () => {
    const [message] = parseWhatsAppWebhook(textMessageWebhook());

    expect(message).toMatchObject({
      channel: 'whatsapp',
      externalMessageId: 'wamid.TEST-MESSAGE-1',
      senderExternalId: '12145550101',
      recipientExternalId: '15550783881',
      text: "I'm coming over tomorrow around three.",
      media: [],
    });
    expect(message!.receivedAt.toISOString()).toBe(new Date(1786600000 * 1000).toISOString());
  });

  it('ignores delivery status callbacks', () => {
    expect(parseWhatsAppWebhook(statusWebhook())).toEqual([]);
  });

  it('normalizes media metadata without treating it as text', () => {
    const [message] = parseWhatsAppWebhook(imageMessageWebhook());

    expect(message!.text).toBeUndefined();
    expect(message!.media).toEqual([
      { externalMediaId: 'media-abc', mediaType: 'image/jpeg', caption: 'Natalie' },
    ]);
  });

  it.each([
    ['null', null],
    ['a string', 'not a payload'],
    ['an empty object', {}],
    ['entry that is not an array', { entry: 'nope' }],
    ['a change with no value', { entry: [{ changes: [{}] }] }],
    ['a message missing its id', { entry: [{ changes: [{ value: { messages: [{ from: '1' }] } }] }] }],
  ])('does not throw on %s', (_label, payload) => {
    expect(() => parseWhatsAppWebhook(payload)).not.toThrow();
    expect(parseWhatsAppWebhook(payload)).toEqual([]);
  });

  it('strips punctuation from the sender identity', () => {
    const [message] = parseWhatsAppWebhook(textMessageWebhook({ from: '+1 (214) 555-0101' }));

    expect(message!.senderExternalId).toBe('12145550101');
  });
});

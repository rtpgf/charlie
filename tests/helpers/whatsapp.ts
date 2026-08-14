import { createHmac } from 'node:crypto';

import { OutboundMessageError, type Messenger } from '../../src/messaging/types.js';

/** Values the test suite shares with vitest.config.ts. */
export const TEST_APP_SECRET = 'test-app-secret';
export const TEST_VERIFY_TOKEN = 'test-verify-token';
export const JENNA_WHATSAPP_ID = '12145550101';
export const STRANGER_WHATSAPP_ID = '12145559999';

/** Signs a body the way Meta does, so tests exercise the real check. */
export function signBody(rawBody: string, appSecret = TEST_APP_SECRET): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
}

export interface TextMessageOptions {
  from?: string;
  messageId?: string;
  body?: string;
  timestamp?: string;
}

/** A realistic inbound text webhook, shaped per Meta's payload examples. */
export function textMessageWebhook(options: TextMessageOptions = {}): unknown {
  const {
    from = JENNA_WHATSAPP_ID,
    messageId = 'wamid.TEST-MESSAGE-1',
    body = "I'm coming over tomorrow around three.",
    timestamp = '1786600000',
  } = options;

  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550783881',
                phone_number_id: '106540352242922',
              },
              contacts: [{ profile: { name: 'Jenna' }, wa_id: from }],
              messages: [
                { from, id: messageId, timestamp, type: 'text', text: { body } },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** An image message: recognized, but not supported for storage in M3. */
export function imageMessageWebhook(from = JENNA_WHATSAPP_ID): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550783881' },
              messages: [
                {
                  from,
                  id: 'wamid.TEST-IMAGE-1',
                  timestamp: '1786600001',
                  type: 'image',
                  image: { id: 'media-abc', mime_type: 'image/jpeg', caption: 'Natalie' },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** A delivery receipt: same endpoint, not a message. */
export function statusWebhook(): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550783881' },
              statuses: [
                { id: 'wamid.TEST-STATUS-1', status: 'delivered', timestamp: '1786600002' },
              ],
            },
          },
        ],
      },
    ],
  };
}

export interface RecordingMessenger extends Messenger {
  sent: Array<{ to: string; text: string }>;
  reactions: Array<{ to: string; messageId: string; emoji: string }>;
}

export function recordingMessenger(): RecordingMessenger {
  const sent: Array<{ to: string; text: string }> = [];
  const reactions: Array<{ to: string; messageId: string; emoji: string }> = [];
  return {
    sent,
    reactions,
    sendText: async (to, text) => {
      sent.push({ to, text });
    },
    react: async (to, messageId, emoji) => {
      reactions.push({ to, messageId, emoji });
    },
  };
}

export function failingMessenger(): Messenger {
  return {
    sendText: () => Promise.reject(new Error('WhatsApp send failed with status 500')),
    react: () => Promise.reject(new Error('WhatsApp send failed with status 500')),
  };
}

/** Rejects reactions but accepts text, exercising the fallback. */
export function reactionUnsupportedMessenger(): RecordingMessenger {
  const base = recordingMessenger();
  return {
    ...base,
    react: () =>
      Promise.reject(
        new OutboundMessageError('WhatsApp send failed with status 400', {
          category: 'provider_error',
          httpStatus: 400,
          providerCode: 100,
        }),
      ),
  };
}

/** Simulates Meta rejecting an expired or invalid access token. */
export function expiredCredentialMessenger(): Messenger {
  const reject = () =>
    Promise.reject(
      new OutboundMessageError('WhatsApp send failed with status 401', {
        category: 'authentication',
        httpStatus: 401,
        providerCode: 190,
      }),
    );
  return { sendText: reject, react: reject };
}


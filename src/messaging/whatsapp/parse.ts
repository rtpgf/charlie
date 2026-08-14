import {
  normalizePhoneIdentity,
  type InboundGroupMessage,
  type InboundMedia,
} from '../types.js';
import type { WhatsAppMedia, WhatsAppMessage, WhatsAppWebhookBody } from './types.js';

/**
 * Meta webhook payload -> Charlie's transport-neutral messages.
 *
 * This is the only place that understands Meta's JSON. It is total: any payload
 * that is not a recognizable message yields an empty list rather than throwing,
 * because status callbacks and future event types arrive on the same endpoint.
 */

const MEDIA_KEYS = ['image', 'video', 'audio', 'document', 'sticker'] as const;

export function parseWhatsAppWebhook(body: unknown): InboundGroupMessage[] {
  const payload = body as WhatsAppWebhookBody | null;
  if (!payload || typeof payload !== 'object') return [];
  if (!Array.isArray(payload.entry)) return [];

  const messages: InboundGroupMessage[] = [];

  for (const entry of payload.entry) {
    if (!Array.isArray(entry?.changes)) continue;

    for (const change of entry.changes) {
      const value = change?.value;
      // Delivery receipts arrive as `statuses`; only `messages` are messages.
      if (!value || !Array.isArray(value.messages)) continue;

      const recipient = value.metadata?.display_phone_number;

      for (const message of value.messages) {
        const parsed = parseMessage(
          message,
          typeof recipient === 'string' ? recipient : undefined,
        );
        if (parsed) messages.push(parsed);
      }
    }
  }

  return messages;
}

function parseMessage(
  message: WhatsAppMessage,
  recipientExternalId: string | undefined,
): InboundGroupMessage | null {
  const id = message?.id;
  const from = message?.from;
  if (typeof id !== 'string' || typeof from !== 'string') return null;

  const text = message.type === 'text' && typeof message.text?.body === 'string'
    ? message.text.body
    : undefined;

  return {
    channel: 'whatsapp',
    externalMessageId: id,
    senderExternalId: normalizePhoneIdentity(from),
    recipientExternalId,
    text,
    media: collectMedia(message),
    receivedAt: parseTimestamp(message.timestamp),
  };
}

/** Metadata only. Nothing is downloaded in this milestone. */
function collectMedia(message: WhatsAppMessage): InboundMedia[] {
  const media: InboundMedia[] = [];

  for (const key of MEDIA_KEYS) {
    const item = message[key] as WhatsAppMedia | undefined;
    if (!item || typeof item.id !== 'string') continue;
    media.push({
      externalMediaId: item.id,
      mediaType: typeof item.mime_type === 'string' ? item.mime_type : key,
      caption: typeof item.caption === 'string' ? item.caption : undefined,
    });
  }

  return media;
}

/** Meta sends Unix seconds as a string. Falls back to now if it is unusable. */
function parseTimestamp(timestamp: unknown): Date {
  if (typeof timestamp === 'string' || typeof timestamp === 'number') {
    const seconds = Number(timestamp);
    if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000);
  }
  return new Date();
}

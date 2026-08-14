import { logger } from '../../logger.js';
import type { Messenger } from '../types.js';

/**
 * The smallest possible WhatsApp Cloud API client: send one text message.
 *
 * POST /{version}/{phone-number-id}/messages
 * developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages
 */

export interface WhatsAppClientConfig {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
}

export function createWhatsAppMessenger(config: WhatsAppClientConfig): Messenger {
  const endpoint = `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`;

  return {
    async sendText(toExternalId: string, text: string): Promise<void> {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          // The token is only ever a header value, never logged.
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: toExternalId,
          type: 'text',
          text: { body: text },
        }),
      });

      if (!response.ok) {
        // Meta's error body carries a code and message but no credentials.
        const detail = await safeErrorDetail(response);
        logger.error('whatsapp send failed', { status: response.status, detail });
        throw new Error(`WhatsApp send failed with status ${response.status}`);
      }
    },
  };
}

async function safeErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    const code = body.error?.code;
    const message = body.error?.message;
    return `${String(code ?? 'unknown')}: ${String(message ?? 'no message')}`;
  } catch {
    return 'unparseable error body';
  }
}

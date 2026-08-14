import { logger } from '../../logger.js';
import {
  OutboundMessageError,
  type Messenger,
  type OutboundFailureCategory,
} from '../types.js';

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
      let response: Response;
      try {
        response = await fetch(endpoint, {
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
      } catch (error: unknown) {
        throw new OutboundMessageError(
          error instanceof Error ? error.message : 'network failure',
          { category: 'network' },
        );
      }

      if (!response.ok) {
        // Meta's error body carries a code and message but never credentials.
        const detail = await safeErrorDetail(response);
        throw new OutboundMessageError(`WhatsApp send failed with status ${response.status}`, {
          category: classify(response.status, detail.code),
          httpStatus: response.status,
          providerCode: detail.code,
        });
      }
    },
  };
}

/**
 * Meta signals an expired or invalid access token with 401, or with 403 plus
 * an OAuth error code (190 is the documented "access token" family). Treating
 * those as `authentication` is what makes an expired development token
 * diagnosable rather than looking like a generic provider outage.
 */
function classify(status: number, code: number | undefined): OutboundFailureCategory {
  if (status === 401) return 'authentication';
  if (status === 403 && (code === 190 || code === 102 || code === 10)) return 'authentication';
  if (status === 429 || code === 4 || code === 80007) return 'rate_limit';
  if (status >= 500) return 'provider_error';
  if (status >= 400) return 'provider_error';
  return 'unknown';
}

async function safeErrorDetail(
  response: Response,
): Promise<{ code: number | undefined; message: string }> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    const code = typeof body.error?.code === 'number' ? body.error.code : undefined;
    const message = typeof body.error?.message === 'string' ? body.error.message : 'no message';
    logger.debug('whatsapp error body', { providerCode: code });
    return { code, message };
  } catch {
    return { code: undefined, message: 'unparseable error body' };
  }
}

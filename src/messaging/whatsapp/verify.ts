import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Meta's two webhook security mechanisms.
 *
 * Uses Node's crypto primitives directly rather than a dependency: this is
 * HMAC-SHA256 plus a constant-time compare, both standard library.
 * See developers.facebook.com/docs/graph-api/webhooks/getting-started
 */

const SIGNATURE_PREFIX = 'sha256=';

/**
 * Subscription-time challenge. Meta sends hub.mode=subscribe with the token
 * configured in the App Dashboard; a match means echoing hub.challenge back.
 * Returns null when the request should be rejected.
 */
export function verifySubscription(
  query: Record<string, unknown>,
  expectedToken: string,
): string | null {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];

  if (mode !== 'subscribe') return null;
  if (typeof token !== 'string' || typeof challenge !== 'string') return null;
  if (!constantTimeEquals(token, expectedToken)) return null;

  return challenge;
}

/**
 * Authenticity of an event delivery. The signature covers the exact bytes Meta
 * sent, so this must run against the raw body -- re-serializing parsed JSON
 * would not reproduce it, particularly because Meta escapes non-ASCII
 * characters in the payload it signs.
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith(SIGNATURE_PREFIX)) return false;

  const expected =
    SIGNATURE_PREFIX + createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

  return constantTimeEquals(signatureHeader, expected);
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

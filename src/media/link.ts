import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived, signed links to a photo, served from Charlie's own domain.
 *
 * Echo Shows will not load Supabase's signed URLs -- 550 characters of JWT in a
 * query string, on a host the device has never talked to -- but they load a
 * short path on the domain Alexa already reaches Charlie through. So Charlie
 * hands out its own link and streams the bytes itself.
 *
 * The token *is* the credential, exactly like the storage URL it replaces:
 * whoever holds it can see the photo until it expires. It carries no household,
 * person, or file name, and it is never logged.
 */

/** Truncated to keep the URL short. 128 bits is far more than a guesser gets. */
const SIGNATURE_BYTES = 16;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest().subarray(0, SIGNATURE_BYTES)
    .toString('base64url');
}

/**
 * `<media id, dashes stripped>.<expiry, base36>.<signature>` -- about 60
 * characters, against 550 for a Supabase signed URL.
 */
export function signMediaToken(input: {
  mediaId: string;
  expiresAt: Date;
  secret: string;
}): string {
  const id = input.mediaId.replace(/-/g, '');
  const expiry = Math.floor(input.expiresAt.getTime() / 1000).toString(36);
  return `${id}.${expiry}.${sign(`${id}.${expiry}`, input.secret)}`;
}

function withDashes(id: string): string {
  return [
    id.slice(0, 8), id.slice(8, 12), id.slice(12, 16), id.slice(16, 20), id.slice(20, 32),
  ].join('-');
}

/**
 * The media id a valid, unexpired token refers to, or null.
 *
 * Returns null for every kind of bad token alike -- malformed, tampered with,
 * expired -- because the caller has no business telling a photo that does not
 * exist from one it is not allowed to see.
 */
export function verifyMediaToken(input: {
  token: string;
  secret: string;
  now: Date;
}): string | null {
  const parts = input.token.split('.');
  if (parts.length !== 3) return null;
  const [id, expiry, signature] = parts as [string, string, string];
  if (!/^[0-9a-f]{32}$/.test(id) || !/^[0-9a-z]{1,12}$/.test(expiry)) return null;

  const expected = Buffer.from(sign(`${id}.${expiry}`, input.secret), 'base64url');
  const given = Buffer.from(signature, 'base64url');
  // Compare before anything else, and in constant time: an attacker must not
  // learn from timing, nor from whether an expiry was plausible.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const expiresAt = Number.parseInt(expiry, 36) * 1000;
  if (!Number.isFinite(expiresAt) || expiresAt <= input.now.getTime()) return null;

  return withDashes(id);
}

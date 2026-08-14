import { logger } from '../logger.js';

/**
 * Charlie's private object storage.
 *
 * Kept behind an interface so Supabase Storage calls do not spread into Alexa,
 * WhatsApp and knowledge code -- and so tests never touch a network. The
 * operations are exactly what the product needs: put a photo, hand out a
 * short-lived link, and delete it permanently.
 */
export interface MediaStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** A time-limited HTTPS URL. Never permanent, never public, never logged. */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}

/**
 * Storage keys are built from opaque ids only.
 *
 * No names, phone numbers, captions, or message text: the key space leaks
 * nothing on its own, and deletion is a matter of following ids rather than
 * guessing at a naming scheme.
 */
export function mediaStorageKey(input: {
  householdId: string;
  mediaId: string;
  extension: string;
}): string {
  return `groups/${input.householdId}/media/${input.mediaId}.${input.extension}`;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function extensionForMimeType(mimeType: string): string | null {
  return MIME_EXTENSIONS[mimeType.toLowerCase()] ?? null;
}

export interface SupabaseStoreConfig {
  /** Project URL, e.g. https://PROJECT.supabase.co */
  url: string;
  /** Service role key. Server-side only; never sent to a device. */
  serviceKey: string;
  /** A private bucket. Public buckets are not supported by design. */
  bucket: string;
}

/**
 * Supabase Storage over its REST API rather than the JS client, to avoid a
 * dependency for three calls.
 */
export function createSupabaseMediaStore(config: SupabaseStoreConfig): MediaStore {
  const base = `${config.url.replace(/\/$/, '')}/storage/v1`;
  const headers = {
    Authorization: `Bearer ${config.serviceKey}`,
    apikey: config.serviceKey,
  };

  return {
    async put(key, body, contentType) {
      const response = await fetch(`${base}/object/${config.bucket}/${key}`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': contentType,
          // Re-storing the same media id must not create a second object.
          'x-upsert': 'true',
        },
        body,
      });
      if (!response.ok) {
        throw new Error(`storage put failed with status ${response.status}`);
      }
    },

    async getSignedUrl(key, expiresInSeconds) {
      const response = await fetch(`${base}/object/sign/${config.bucket}/${key}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: expiresInSeconds }),
      });
      if (!response.ok) {
        throw new Error(`signed url failed with status ${response.status}`);
      }
      const body = (await response.json()) as { signedURL?: unknown };
      if (typeof body.signedURL !== 'string') {
        throw new Error('signed url response missing signedURL');
      }
      // Deliberately not logged anywhere: the URL is the credential.
      return `${config.url.replace(/\/$/, '')}/storage/v1${body.signedURL}`;
    },

    async delete(key) {
      const response = await fetch(`${base}/object/${config.bucket}/${key}`, {
        method: 'DELETE',
        headers,
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`storage delete failed with status ${response.status}`);
      }
      logger.info('deleted stored media object');
    },
  };
}

import { OutboundMessageError } from '../messaging/types.js';

/**
 * Fetching inbound media from Meta.
 *
 * Two steps, and the second is time-critical: the download URL Meta returns is
 * valid for about five minutes, so retrieval cannot be deferred to a later pass.
 * The media id itself lasts seven days, which is what makes reprocessing
 * possible at all.
 */

export interface MediaDownload {
  bytes: Uint8Array;
  mimeType: string;
  byteSize: number;
}

export interface MediaFetcher {
  download(providerMediaId: string): Promise<MediaDownload>;
}

/** WhatsApp image formats Charlie accepts. Not a general file platform. */
export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Comfortably above a phone photo, far below anything that should be streamed. */
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

export class MediaRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaRejectedError';
  }
}

/**
 * Magic-number sniffing. The provider's declared mime type is a claim about
 * the bytes, not the bytes themselves, and only the bytes are sent to a vision
 * model -- so the content is what gets checked.
 */
export function detectImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Throws MediaRejectedError when the download should not be stored. */
export function validateDownload(download: MediaDownload): string {
  if (download.byteSize > MAX_MEDIA_BYTES) {
    throw new MediaRejectedError(`media too large: ${download.byteSize} bytes`);
  }
  if (download.byteSize === 0) {
    throw new MediaRejectedError('media is empty');
  }

  const actual = detectImageType(download.bytes);
  if (!actual) {
    throw new MediaRejectedError('content is not a supported image');
  }
  if (!SUPPORTED_IMAGE_TYPES.includes(actual as (typeof SUPPORTED_IMAGE_TYPES)[number])) {
    throw new MediaRejectedError(`unsupported image type: ${actual}`);
  }
  return actual;
}

export interface WhatsAppMediaFetcherConfig {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
}

export function createWhatsAppMediaFetcher(
  config: WhatsAppMediaFetcherConfig,
): MediaFetcher {
  const headers = { Authorization: `Bearer ${config.accessToken}` };

  return {
    async download(providerMediaId: string): Promise<MediaDownload> {
      // Step 1: exchange the media id for a short-lived download URL.
      const metaResponse = await fetch(
        `https://graph.facebook.com/${config.graphApiVersion}/${providerMediaId}` +
          `?phone_number_id=${config.phoneNumberId}`,
        { headers },
      );
      if (!metaResponse.ok) {
        throw new OutboundMessageError(
          `media metadata failed with status ${metaResponse.status}`,
          {
            category: metaResponse.status === 401 ? 'authentication' : 'provider_error',
            httpStatus: metaResponse.status,
          },
        );
      }

      const metadata = (await metaResponse.json()) as {
        url?: unknown;
        mime_type?: unknown;
        file_size?: unknown;
      };
      if (typeof metadata.url !== 'string') {
        throw new Error('media metadata missing url');
      }

      // Step 2: the URL still requires the bearer token, and expires in ~5
      // minutes, so this happens now rather than on a later pass.
      const fileResponse = await fetch(metadata.url, { headers });
      if (!fileResponse.ok) {
        throw new OutboundMessageError(
          `media download failed with status ${fileResponse.status}`,
          {
            category: fileResponse.status === 401 ? 'authentication' : 'provider_error',
            httpStatus: fileResponse.status,
          },
        );
      }

      const bytes = new Uint8Array(await fileResponse.arrayBuffer());
      return {
        bytes,
        mimeType: typeof metadata.mime_type === 'string' ? metadata.mime_type : 'application/octet-stream',
        byteSize: bytes.byteLength,
      };
    },
  };
}

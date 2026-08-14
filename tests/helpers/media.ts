import type { MediaFetcher, MediaDownload } from '../../src/media/retrieve.js';
import type { ImageResizer } from '../../src/media/resize.js';
import type { MediaStore } from '../../src/media/store.js';
import type {
  MediaAnalysisContext,
  MediaAnalysisProposal,
  MediaAnalyzer,
} from '../../src/media/types.js';
import { MEDIA_SCHEMA_VERSION } from '../../src/media/types.js';

/** Real JPEG magic bytes, so content sniffing is exercised rather than stubbed. */
export function jpegBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

export function pngBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

/** Something that is not an image at all, whatever the provider claims. */
export function pdfBytes(): Uint8Array {
  return new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
}

export interface RecordingStore extends MediaStore {
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
  signed: { key: string; expiresIn: number }[];
  deleted: string[];
}

export function recordingStore(): RecordingStore {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const signed: { key: string; expiresIn: number }[] = [];
  const deleted: string[] = [];
  return {
    objects,
    signed,
    deleted,
    put: async (key, bytes, contentType) => {
      objects.set(key, { bytes, contentType });
    },
    get: async (key) => {
      const object = objects.get(key);
      if (!object) throw new Error(`storage get failed with status 404`);
      return object;
    },
    getSignedUrl: async (key, expiresIn) => {
      signed.push({ key, expiresIn });
      return `https://storage.example/signed/${encodeURIComponent(key)}?token=abc&exp=${expiresIn}`;
    },
    delete: async (key) => {
      objects.delete(key);
      deleted.push(key);
    },
  };
}

export interface RecordingResizer extends ImageResizer {
  resized: number[];
}

/**
 * Pretends anything over `threshold` bytes is a camera original.
 * Portrait by default, which is what a phone produces.
 */
export function recordingResizer(
  options: { threshold?: number; width?: number; height?: number } = {},
): RecordingResizer {
  const resized: number[] = [];
  const width = options.width ?? 1200;
  const height = options.height ?? 1600;
  return {
    resized,
    toDisplaySize: async (bytes) => {
      const needsResize = bytes.byteLength > (options.threshold ?? 0);
      if (needsResize) resized.push(bytes.byteLength);
      return {
        bytes: needsResize ? new Uint8Array([0xff, 0xd8, 0xff, 0xdb]) : bytes,
        mimeType: 'image/jpeg',
        width,
        height,
        resized: needsResize,
      };
    },
  };
}

export function failingStore(): MediaStore {
  return {
    put: () => Promise.reject(new Error('storage put failed with status 500')),
    get: () => Promise.reject(new Error('storage get failed with status 500')),
    getSignedUrl: () => Promise.reject(new Error('signed url failed with status 500')),
    delete: () => Promise.resolve(),
  };
}

export interface RecordingFetcher extends MediaFetcher {
  requested: string[];
}

export function recordingFetcher(
  download: Partial<MediaDownload> = {},
): RecordingFetcher {
  const requested: string[] = [];
  const bytes = download.bytes ?? jpegBytes();
  return {
    requested,
    download: async (id) => {
      requested.push(id);
      return {
        bytes,
        mimeType: download.mimeType ?? 'image/jpeg',
        byteSize: download.byteSize ?? bytes.byteLength,
      };
    },
  };
}

export function failingFetcher(): MediaFetcher {
  return { download: () => Promise.reject(new Error('media download failed with status 404')) };
}

export interface RecordingAnalyzer extends MediaAnalyzer {
  calls: MediaAnalysisContext[];
}

/** Returns one analysis per supplied image, so ids always line up. */
export function recordingAnalyzer(
  overrides: { peopleVisible?: number; namedPeople?: string[]; batchSummary?: string } = {},
): RecordingAnalyzer {
  const calls: MediaAnalysisContext[] = [];
  return {
    calls,
    provider: 'stub',
    model: 'stub-model',
    analyze: async (context) => {
      calls.push(context);
      const proposal: MediaAnalysisProposal = {
        schemaVersion: MEDIA_SCHEMA_VERSION,
        batchSummary: overrides.batchSummary ?? 'a day at the beach',
        images: context.media.map((item) => ({
          mediaId: item.mediaId,
          description: 'a child on the sand',
          peopleVisible: overrides.peopleVisible ?? 1,
          namedPeople: overrides.namedPeople ?? [],
        })),
      };
      return proposal;
    },
  };
}

export function failingAnalyzer(): MediaAnalyzer {
  return {
    provider: 'stub',
    model: 'stub-model',
    analyze: () => Promise.reject(new Error('vision provider unavailable')),
  };
}

/** A WhatsApp image webhook, with control over the media id and caption. */
export function imageWebhook(options: {
  mediaId: string;
  messageId: string;
  caption?: string | undefined;
  from?: string;
  timestamp?: string;
}): unknown {
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
                  from: options.from ?? '12145550101',
                  id: options.messageId,
                  timestamp: options.timestamp ?? '1786600000',
                  type: 'image',
                  image: {
                    id: options.mediaId,
                    mime_type: 'image/jpeg',
                    ...(options.caption ? { caption: options.caption } : {}),
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

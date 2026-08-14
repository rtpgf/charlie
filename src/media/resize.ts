import type { MediaStore } from './store.js';

/**
 * A screen-sized copy of a photo.
 *
 * A phone camera produces something like 3072x4096 -- 12.6 megapixels for a
 * screen about 1280x800. An Echo Show does not decode it and reports nothing,
 * so the photo silently never appears. Charlie keeps the original untouched
 * and stores a display copy beside it.
 *
 * Behind an interface like every other capability: tests inject a fake and
 * never load an image library, and the fixtures are not real JPEGs.
 */

export interface DisplayImage {
  bytes: Uint8Array;
  mimeType: string;
}

export interface ImageResizer {
  /** Null when the image is already small enough, or cannot be read. */
  toDisplaySize(bytes: Uint8Array): Promise<DisplayImage | null>;
}

/** Comfortably above any current Echo Show, well below a camera original. */
export const DISPLAY_MAX_EDGE = 1600;

/**
 * The display copy sits beside the original, derived from its key rather than
 * stored in a column: one object, one place, and no migration to find it.
 */
export function displayStorageKey(storageKey: string): string {
  return `${storageKey.replace(/\.[^./]+$/, '')}.display.jpg`;
}

export function createSharpResizer(): ImageResizer {
  return {
    async toDisplaySize(bytes) {
      // Imported lazily: sharp is a native module, and nothing that does not
      // resize an image should pay to load it.
      const { default: sharp } = await import('sharp');
      const image = sharp(Buffer.from(bytes), { failOn: 'error' });
      const { width, height } = await image.metadata();
      if (!width || !height) return null;
      if (width <= DISPLAY_MAX_EDGE && height <= DISPLAY_MAX_EDGE) return null;

      const resized = await image
        .rotate() // Honour EXIF orientation before the tag is dropped.
        .resize({
          width: DISPLAY_MAX_EDGE,
          height: DISPLAY_MAX_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();

      return { bytes: new Uint8Array(resized), mimeType: 'image/jpeg' };
    },
  };
}

/**
 * Stores a display copy if the photo needs one.
 *
 * Best effort by design: a family photo that is stored but has no display copy
 * is still safe, still analyzed, and still there. Failing here must not undo
 * the ingest that succeeded.
 */
export async function storeDisplayCopy(input: {
  storageKey: string;
  bytes: Uint8Array;
  store: MediaStore;
  resizer: ImageResizer;
}): Promise<boolean> {
  const display = await input.resizer.toDisplaySize(input.bytes);
  if (!display) return false;
  await input.store.put(displayStorageKey(input.storageKey), display.bytes, display.mimeType);
  return true;
}

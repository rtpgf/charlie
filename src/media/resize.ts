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
  width: number;
  height: number;
  /** False when the original was already small enough to serve as-is. */
  resized: boolean;
}

export interface ImageResizer {
  /**
   * The copy a screen should be sent, and its shape.
   *
   * Null only when the image cannot be read at all. An image that needs no
   * resizing still comes back measured, because the shape is needed to decide
   * which way a photograph pans -- see `displayStorageKey`.
   */
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
      const meta = await image.metadata();
      if (!meta.width || !meta.height) return null;

      // EXIF orientation is applied on resize, so a photo the camera recorded
      // sideways reports the shape it will actually be displayed at.
      const upright = (meta.orientation ?? 1) >= 5;
      const width = upright ? meta.height : meta.width;
      const height = upright ? meta.width : meta.height;

      if (width <= DISPLAY_MAX_EDGE && height <= DISPLAY_MAX_EDGE) {
        return { bytes, mimeType: `image/${meta.format}`, width, height, resized: false };
      }

      const scale = DISPLAY_MAX_EDGE / Math.max(width, height);
      const output = await image
        .rotate() // Honour EXIF orientation before the tag is dropped.
        .resize({
          width: DISPLAY_MAX_EDGE,
          height: DISPLAY_MAX_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();

      return {
        bytes: new Uint8Array(output),
        mimeType: 'image/jpeg',
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        resized: true,
      };
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
}): Promise<{ stored: boolean; width: number; height: number } | null> {
  const display = await input.resizer.toDisplaySize(input.bytes);
  if (!display) return null;
  if (display.resized) {
    await input.store.put(displayStorageKey(input.storageKey), display.bytes, display.mimeType);
  }
  return { stored: display.resized, width: display.width, height: display.height };
}

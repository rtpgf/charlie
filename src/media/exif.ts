/**
 * Minimal EXIF capture-time reader for JPEG.
 *
 * Only DateTimeOriginal, only from a JPEG APP1 segment. This exists because a
 * capture time embedded by the camera is real evidence, and future Memories
 * will need it — but Charlie must never *invent* one, so an absent or
 * unreadable tag returns null rather than falling back to anything.
 */

const APP1 = 0xe1;
const DATE_TIME_ORIGINAL = 0x9003;
const TIFF_LITTLE_ENDIAN = 0x4949;

/** "2019:07:04 14:22:31" -> Date, or null if it is not that shape. */
function parseExifDate(value: string): Date | null {
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  // EXIF timestamps carry no zone. Treated as UTC rather than guessed at —
  // the confidence recorded alongside it says "approximate" for this reason.
  const date = new Date(
    Date.UTC(+year!, +month! - 1, +day!, +hour!, +minute!, +second!),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export function readJpegCaptureTime(bytes: Uint8Array): Date | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  // Walk JPEG segments looking for APP1 (which carries EXIF).
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    const length = view.getUint16(offset + 2, false);
    if (length < 2) return null;

    if (marker === APP1) {
      const segment = offset + 4;
      const header = String.fromCharCode(...bytes.slice(segment, segment + 4));
      if (header === 'Exif') return readExifDate(view, bytes, segment + 6);
      return null;
    }

    // Start of scan: image data follows, no more metadata to find.
    if (marker === 0xda) return null;
    offset += 2 + length;
  }
  return null;
}

function readExifDate(view: DataView, bytes: Uint8Array, tiffStart: number): Date | null {
  if (tiffStart + 8 > bytes.length) return null;

  const little = view.getUint16(tiffStart, false) === TIFF_LITTLE_ENDIAN;
  const ifdOffset = view.getUint32(tiffStart + 4, little);

  // The tag lives in the Exif sub-IFD, reached from the main IFD's 0x8769 tag.
  const exifIfd = findTagValue(view, bytes, tiffStart, tiffStart + ifdOffset, little, 0x8769);
  const candidates = [tiffStart + ifdOffset, exifIfd ? tiffStart + exifIfd : null];

  for (const ifd of candidates) {
    if (ifd === null) continue;
    const value = findStringTag(view, bytes, tiffStart, ifd, little, DATE_TIME_ORIGINAL);
    if (value) {
      const parsed = parseExifDate(value);
      if (parsed) return parsed;
    }
  }
  return null;
}

function eachEntry(
  view: DataView,
  bytes: Uint8Array,
  ifd: number,
  little: boolean,
  visit: (tag: number, type: number, count: number, valueOffset: number) => boolean,
): void {
  if (ifd + 2 > bytes.length) return;
  const count = view.getUint16(ifd, little);

  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > bytes.length) return;
    const stop = visit(
      view.getUint16(entry, little),
      view.getUint16(entry + 2, little),
      view.getUint32(entry + 4, little),
      entry + 8,
    );
    if (stop) return;
  }
}

function findTagValue(
  view: DataView,
  bytes: Uint8Array,
  _tiffStart: number,
  ifd: number,
  little: boolean,
  wanted: number,
): number | null {
  let found: number | null = null;
  eachEntry(view, bytes, ifd, little, (tag, _type, _count, valueOffset) => {
    if (tag !== wanted) return false;
    found = view.getUint32(valueOffset, little);
    return true;
  });
  return found;
}

function findStringTag(
  view: DataView,
  bytes: Uint8Array,
  tiffStart: number,
  ifd: number,
  little: boolean,
  wanted: number,
): string | null {
  let found: string | null = null;
  eachEntry(view, bytes, ifd, little, (tag, type, count, valueOffset) => {
    if (tag !== wanted || type !== 2) return false; // type 2 is ASCII
    const start = count > 4 ? tiffStart + view.getUint32(valueOffset, little) : valueOffset;
    if (start + count > bytes.length) return true;
    found = String.fromCharCode(...bytes.slice(start, start + count - 1));
    return true;
  });
  return found;
}

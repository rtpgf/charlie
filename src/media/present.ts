import type { GalleryBatch } from './gallery.js';

/**
 * What Charlie says about a set of photos.
 *
 * Deterministic, like the agenda: assembled from stored rows, no model
 * involved. The screenless case matters as much as the Echo Show one — a
 * device without a display should get something useful, never "this device
 * doesn't support pictures".
 */

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/** "today" / "yesterday" / "on Saturday" for a shared-at instant. */
export function sharedWhen(sharedAt: Date, now: Date, timezone: string): string {
  const day = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);

  if (day(sharedAt) === day(now)) return 'today';
  if (day(sharedAt) === day(new Date(now.getTime() - 86_400_000))) return 'yesterday';

  const withinWeek = now.getTime() - sharedAt.getTime() < 7 * 86_400_000;
  return withinWeek
    ? `on ${new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(sharedAt)}`
    : `on ${new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'long', day: 'numeric' }).format(sharedAt)}`;
}

/**
 * The line spoken when a batch is first shown. The family's own caption is
 * preferred over anything a model wrote about the photos.
 */
export function describeBatch(
  batch: GalleryBatch,
  options: { now: Date; timezone: string; hasScreen: boolean },
): string {
  const count = batch.items.length;
  const when = sharedWhen(batch.sharedAt, options.now, options.timezone);
  const context = batch.caption?.trim() || batch.summary?.trim() || null;

  if (options.hasScreen) {
    // The photo is already on screen; the words add who and what, not a count.
    return context
      ? `${batch.senderName} sent ${plural(count, 'this', 'these')} ${when}. ${context}`
      : `${batch.senderName} sent ${plural(count, 'this', 'these')} ${when}.`;
  }

  // Screenless: the words are all there is, so lead with how many.
  const noun = `${count} ${plural(count, 'picture', 'pictures')}`;
  return context
    ? `${batch.senderName} sent ${noun} ${when}. ${context}`
    : `${batch.senderName} sent ${noun} ${when}.`;
}

/** The caption drawn on the Echo Show alongside a photo. */
export function slideCaption(batch: GalleryBatch): string {
  const context = batch.caption?.trim() || batch.summary?.trim();
  return context ? `${batch.senderName}: ${context}` : `Sent by ${batch.senderName}`;
}

export function positionLabel(index: number, total: number): string | undefined {
  return total > 1 ? `${index + 1} of ${total}` : undefined;
}

export function emptyGallery(): string {
  return "I don't have any pictures from the group yet.";
}

export function endOfBatch(): string {
  return "That's the last one.";
}

export function startOfBatch(): string {
  return "That's the first one.";
}

export function noPhotoInView(): string {
  return "I'm not showing a picture right now. Try asking to see the latest pictures.";
}

/** The signed URL could not be produced; never fall back to a public URL. */
export function cannotShowRightNow(): string {
  return "I'm having trouble showing that picture right now.";
}

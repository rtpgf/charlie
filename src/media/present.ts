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

/**
 * What Charlie says when asked for pictures of one person.
 *
 * Deliberately says the name back. Someone who asked for JT and is shown
 * Natalie should hear the mistake, not have to notice it.
 */
export function describePersonPhotos(
  name: string,
  count: number,
  options: { hasScreen: boolean },
): string {
  if (options.hasScreen) {
    return count === 1 ? `Here's a picture of ${name}.` : `Here are ${count} pictures of ${name}.`;
  }
  return count === 1
    ? `I have one picture of ${name}.`
    : `I have ${count} pictures of ${name}.`;
}

/**
 * Nothing found, said so that it cannot be mistaken for a different answer.
 *
 * "Yet" because Charlie learns people from ordinary family language: the honest
 *state is not knowing, not never.
 */
export function noPicturesOfPerson(name: string): string {
  return `I don't have any pictures of ${name} yet.`;
}

/** Asked about someone Charlie has never heard of. */
export function unknownPersonForPhotos(name: string): string {
  return `I don't know anyone called ${name}.`;
}

/**
 * The caption drawn on the Echo Show under one photograph.
 *
 * The photo's own words win. A share's caption is a fallback, not a
 * description: WhatsApp puts one caption on the first photo of a set, so the
 * rest genuinely have nothing of their own to say and inherit it -- but a photo
 * that arrived with "Hannah and Natalie swimming" must never be labelled with
 * whatever was said about the photo before it.
 */
export function photoCaption(
  item: { caption: string | null; senderName?: string | undefined },
  batch: { senderName: string; caption: string | null; summary: string | null },
): string {
  const sender = item.senderName ?? batch.senderName;
  const own = item.caption?.trim();
  if (own) return `${sender}: ${own}`;

  const shared = batch.caption?.trim() || batch.summary?.trim();
  return shared ? `${batch.senderName}: ${shared}` : `Sent by ${sender}`;
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

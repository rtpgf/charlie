import type { RequestEnvelope, ResponseEnvelope } from 'ask-sdk-model';

import type { Db } from '../db/index.js';
import { findHouseholdTimezone } from '../knowledge/repository.js';
import { logger } from '../logger.js';
import { getBatch, getLatestBatch, type GalleryBatch } from '../media/gallery.js';
import { signMediaToken } from '../media/link.js';
import {
  cannotShowRightNow,
  describeBatch,
  emptyGallery,
  endOfBatch,
  noPhotoInView,
  positionLabel,
  sharedWhen,
  slideCaption,
  startOfBatch,
} from '../media/present.js';
import type { MediaStore } from '../media/store.js';
import { renderPhotoDirective, supportsApl } from './apl.js';
import { speak } from './responses.js';

/**
 * Showing group photos on an Echo Show, and saying something useful when there
 * is no screen.
 *
 * Navigation state lives in Alexa session attributes rather than the database:
 * which photo someone is looking at is not group knowledge, and a fresh
 * "show me the latest pictures" rebuilds the gallery from Charlie's own data.
 */

/** Long enough to look through a batch, short enough to be worth little if leaked. */
export const SIGNED_URL_SECONDS = 15 * 60;

/** Where photos are served from, when Charlie serves them itself. */
export interface MediaLinkConfig {
  /** Charlie's own HTTPS origin, without a trailing slash. */
  baseUrl: string;
  secret: string;
}

export interface PhotoDeps {
  db: Db;
  store?: MediaStore | undefined;
  link?: MediaLinkConfig | undefined;
}

interface PhotoSession {
  batchId: string;
  index: number;
}

function readSession(envelope: RequestEnvelope): PhotoSession | null {
  const attributes = envelope.session?.attributes as Record<string, unknown> | undefined;
  const batchId = attributes?.['photoBatchId'];
  const index = attributes?.['photoIndex'];
  if (typeof batchId !== 'string' || typeof index !== 'number') return null;
  return { batchId, index };
}

function writeSession(session: PhotoSession): Record<string, unknown> {
  return { photoBatchId: session.batchId, photoIndex: session.index };
}

/**
 * The URL the device will fetch the photo from.
 *
 * Charlie's own domain when it is configured, because an Echo Show loads a
 * short path on the host it already talks to and silently refuses a long
 * storage URL. Storage's own signed URL otherwise, which still works
 * everywhere else and keeps photos working before that configuration exists.
 */
async function photoUrl(
  mediaId: string,
  storageKey: string,
  deps: PhotoDeps,
  store: MediaStore,
): Promise<string> {
  if (!deps.link) return store.getSignedUrl(storageKey, SIGNED_URL_SECONDS);

  const token = signMediaToken({
    mediaId,
    expiresAt: new Date(Date.now() + SIGNED_URL_SECONDS * 1000),
    secret: deps.link.secret,
  });
  return `${deps.link.baseUrl}/media/${token}`;
}

/** Builds the response for one photo of a batch, with or without a screen. */
async function showSlide(
  envelope: RequestEnvelope,
  deps: PhotoDeps,
  batch: GalleryBatch,
  index: number,
  spoken: string,
): Promise<ResponseEnvelope> {
  const session = writeSession({ batchId: batch.batchId, index });

  if (!supportsApl(envelope) || !deps.store) {
    // Screenless is a first-class outcome, not a failure.
    return speak(spoken, { keepSessionOpen: true, sessionAttributes: session });
  }

  const item = batch.items[index];
  if (!item) return speak(spoken, { keepSessionOpen: true, sessionAttributes: session });

  let imageUrl: string;
  try {
    imageUrl = await photoUrl(item.mediaId, item.storageKey, deps, deps.store);
  } catch (error: unknown) {
    // Never fall back to a public URL. Speak, and skip the picture.
    logger.error('signed url generation failed', {
      mediaId: item.mediaId,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return speak(`${spoken} ${cannotShowRightNow()}`, {
      keepSessionOpen: true,
      sessionAttributes: session,
    });
  }

  return speak(spoken, {
    keepSessionOpen: true,
    sessionAttributes: session,
    directives: [
      renderPhotoDirective({
        imageUrl,
        caption: slideCaption(batch),
        position: positionLabel(index, batch.items.length),
      }),
    ],
  });
}

export async function handleShowLatestPhotos(
  envelope: RequestEnvelope,
  deps: PhotoDeps,
  householdId: string,
): Promise<ResponseEnvelope> {
  const batch = await getLatestBatch(deps.db, householdId);
  if (!batch || batch.items.length === 0) return speak(emptyGallery());

  const timezone = await findHouseholdTimezone(deps.db, householdId);
  const spoken = describeBatch(batch, {
    now: new Date(),
    timezone,
    hasScreen: supportsApl(envelope),
  });

  return showSlide(envelope, deps, batch, 0, spoken);
}

export async function handlePhotoNavigation(
  envelope: RequestEnvelope,
  deps: PhotoDeps,
  direction: 'next' | 'previous',
): Promise<ResponseEnvelope> {
  const session = readSession(envelope);
  if (!session) return speak(noPhotoInView());

  const batch = await getBatch(deps.db, session.batchId);
  if (!batch || batch.items.length === 0) return speak(emptyGallery());

  const wanted = direction === 'next' ? session.index + 1 : session.index - 1;
  if (wanted >= batch.items.length) {
    return speak(endOfBatch(), {
      keepSessionOpen: true,
      sessionAttributes: writeSession(session),
    });
  }
  if (wanted < 0) {
    return speak(startOfBatch(), {
      keepSessionOpen: true,
      sessionAttributes: writeSession(session),
    });
  }

  const item = batch.items[wanted]!;
  const spoken = item.description ?? positionLabel(wanted, batch.items.length) ?? '';
  return showSlide(envelope, deps, batch, wanted, spoken);
}

/** "Who sent these?" and "when did she send them?" about what is in view. */
export async function handlePhotoQuestion(
  envelope: RequestEnvelope,
  deps: PhotoDeps,
  question: 'sender' | 'when',
): Promise<ResponseEnvelope> {
  const session = readSession(envelope);
  if (!session) return speak(noPhotoInView());

  const batch = await getBatch(deps.db, session.batchId);
  if (!batch) return speak(emptyGallery());

  const attributes = writeSession(session);

  if (question === 'sender') {
    return speak(`${batch.senderName} sent ${batch.items.length === 1 ? 'it' : 'them'}.`, {
      keepSessionOpen: true,
      sessionAttributes: attributes,
    });
  }

  const timezone = await findHouseholdTimezone(deps.db, batch.householdId);
  const when = sharedWhen(batch.sharedAt, new Date(), timezone);
  return speak(`${batch.senderName} sent ${batch.items.length === 1 ? 'it' : 'them'} ${when}.`, {
    keepSessionOpen: true,
    sessionAttributes: attributes,
  });
}

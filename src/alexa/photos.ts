import type { RequestEnvelope, ResponseEnvelope } from 'ask-sdk-model';

import type { Db } from '../db/index.js';
import { findPeopleByName } from '../group/graph.js';
import { loadGroupGraph } from '../group/repository.js';
import { findHouseholdTimezone } from '../knowledge/repository.js';
import { logger } from '../logger.js';
import {
  getBatch,
  getLatestBatch,
  getRecentMediaByPerson,
  type GalleryItem,
} from '../media/gallery.js';
import { signMediaToken } from '../media/link.js';
import {
  cannotShowRightNow,
  describeBatch,
  describePersonPhotos,
  emptyGallery,
  endOfBatch,
  noPhotoInView,
  noPicturesOfPerson,
  positionLabel,
  sharedWhen,
  photoCaption,
  startOfBatch,
  unknownPersonForPhotos,
} from '../media/present.js';
import type { MediaStore } from '../media/store.js';
import {
  movePhotoDirective,
  renderPhotoDirective,
  supportsApl,
  type PhotoFit,
  type PhotoSlide,
} from './apl.js';
import { speak } from './responses.js';

/**
 * Showing group photos on an Echo Show, and saying something useful when there
 * is no screen.
 *
 * Two ways in: a share ("the latest pictures") and a person ("pictures of JT").
 * Both end up as the same thing on screen -- a set of photos with a line of
 * context -- so everything below the entry points works on a `PhotoView` and
 * does not care which question produced it.
 *
 * Navigation state lives in Alexa session attributes rather than the database:
 * which photo someone is looking at is not group knowledge, and asking again
 * rebuilds the view from Charlie's own data.
 */

/** Long enough to look through a set, short enough to be worth little if leaked. */
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
  /**
   * Whole photograph or filled screen. A setting for now, and the seam a
   * per-person preference would sit behind later -- which is why it is passed
   * in rather than read from configuration down in the document builder.
   */
  photoFit?: PhotoFit | undefined;
  /** The slow drift across a still photograph. Defaults to on. */
  photoMotion?: boolean | undefined;
  /**
   * Keep the microphone open after showing a photo. Defaults to on, because an
   * APL document lives only as long as the session that rendered it.
   */
  listenAfterPhotos?: boolean | undefined;
}

/** A set of photos on screen, however it was asked for. */
interface PhotoView {
  items: GalleryItem[];
  /** The line under each photo, given that photo and its share. */
  caption: (item: GalleryItem) => string;
  /** Everyone who shared something in this view, in no particular order. */
  senders: string[];
  householdId: string;
  session: PhotoSession;
}

type PhotoSession =
  | { kind: 'batch'; id: string; index: number }
  | { kind: 'person'; id: string; name: string; index: number };

function readSession(envelope: RequestEnvelope): PhotoSession | null {
  const attributes = envelope.session?.attributes as Record<string, unknown> | undefined;
  const index = attributes?.['photoIndex'];
  if (typeof index !== 'number') return null;

  const batchId = attributes?.['photoBatchId'];
  if (typeof batchId === 'string') return { kind: 'batch', id: batchId, index };

  const personId = attributes?.['photoPersonId'];
  const personName = attributes?.['photoPersonName'];
  if (typeof personId === 'string' && typeof personName === 'string') {
    return { kind: 'person', id: personId, name: personName, index };
  }
  return null;
}

function writeSession(session: PhotoSession): Record<string, unknown> {
  return session.kind === 'batch'
    ? { photoBatchId: session.id, photoIndex: session.index }
    : { photoPersonId: session.id, photoPersonName: session.name, photoIndex: session.index };
}

/**
 * Rebuilds what is on screen from the session.
 *
 * Re-queried rather than carried in the session, so a view is always current
 * data. The household is required for a person view and checked against the
 * batch for a share -- a session attribute is a claim from the network, not a
 * permission.
 */
async function resolveView(
  deps: PhotoDeps,
  session: PhotoSession,
  householdId: string | undefined,
): Promise<PhotoView | null> {
  if (session.kind === 'batch') {
    const batch = await getBatch(deps.db, session.id);
    if (!batch || batch.items.length === 0) return null;
    if (householdId && batch.householdId !== householdId) {
      logger.warn('photo session named a batch from another group');
      return null;
    }
    return {
      items: batch.items,
      caption: (item) => photoCaption(item, batch),
      senders: [batch.senderName],
      householdId: batch.householdId,
      session,
    };
  }

  if (!householdId) return null;
  const items = await getRecentMediaByPerson(deps.db, { householdId, personId: session.id });
  if (items.length === 0) return null;
  return {
    items,
    caption: acrossShares,
    senders: [...new Set(items.map((item) => item.senderName).filter(Boolean) as string[])],
    householdId,
    session,
  };
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

/**
 * Whether to hold the session open, and with it the microphone.
 *
 * Almost always yes, and the reason is not the microphone. An APL document is
 * displayed only while the session that rendered it is alive: end the session
 * and the Echo Show returns to its home screen, taking the photograph with it
 * a few seconds after Charlie finishes speaking.
 *
 * So the listening bar -- which dims the screen for as long as Alexa listens --
 * is the price of the photograph staying on screen at all. There is no third
 * option: the open microphone and the indicator are the same thing.
 *
 * Without a screen it is simpler: speech is the only way through a set.
 */
function keepListening(envelope: RequestEnvelope, deps: PhotoDeps): boolean {
  if (!supportsApl(envelope) || !deps.store) return true;
  return deps.listenAfterPhotos ?? true;
}

/**
 * Puts a whole view on screen at once, or says it when there is no screen.
 *
 * Every photo is rendered up front, because a Pager is what makes the set
 * swipeable and a Pager holds all its pages. That is a real cost -- a six photo
 * set is every photo fetched at once rather than one at a time -- and it buys
 * the thing worth having: someone can touch the screen instead of talking to it.
 */
async function showView(
  envelope: RequestEnvelope,
  deps: PhotoDeps,
  view: PhotoView,
  spoken: string,
): Promise<ResponseEnvelope> {
  const session = writeSession(view.session);

  if (!supportsApl(envelope) || !deps.store) {
    // Screenless is a first-class outcome, not a failure.
    return speak(spoken, { keepSessionOpen: true, sessionAttributes: session });
  }

  const store = deps.store;
  let slides: PhotoSlide[];
  try {
    slides = await Promise.all(
      view.items.map(async (item, index) => ({
        imageUrl: await photoUrl(item.mediaId, item.storageKey, deps, store),
        caption: view.caption(item),
        position: positionLabel(index, view.items.length),
        aspect: item.aspect,
      })),
    );
  } catch (error: unknown) {
    // Never fall back to a public URL. Speak, and skip the pictures.
    logger.error('signed url generation failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return speak(`${spoken} ${cannotShowRightNow()}`, {
      keepSessionOpen: true,
      sessionAttributes: session,
    });
  }

  return speak(spoken, {
    keepSessionOpen: keepListening(envelope, deps),
    sessionAttributes: session,
    directives: [
      renderPhotoDirective({
        slides,
        fit: deps.photoFit,
        motion: deps.photoMotion,
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

  return showView(
    envelope,
    deps,
    {
      items: batch.items,
      caption: (item) => photoCaption(item, batch),
      senders: [batch.senderName],
      householdId,
      session: { kind: 'batch', id: batch.batchId, index: 0 },
    },
    spoken,
  );
}

/**
 * "Show me pictures of JT."
 *
 * Answers about the person asked for or not at all. Being shown someone else's
 * photos is worse than being told there are none: the second is a fact, the
 * first is Charlie being confidently wrong about a grandchild.
 */
export async function handleShowPicturesOfPerson(
  envelope: RequestEnvelope,
  deps: PhotoDeps,
  householdId: string,
  spokenName: string,
): Promise<ResponseEnvelope> {
  const graph = await loadGroupGraph(deps.db, householdId);
  const person = findPeopleByName(graph, spokenName)[0];
  if (!person) return speak(unknownPersonForPhotos(spokenName));

  // Accepted evidence only, and never weak_context -- a caption naming someone
  // over a crowd says who the occasion involved, not whose face is whose.
  const items = await getRecentMediaByPerson(deps.db, { householdId, personId: person.id });
  if (items.length === 0) return speak(noPicturesOfPerson(person.preferredName));

  const spoken = describePersonPhotos(person.preferredName, items.length, {
    hasScreen: supportsApl(envelope),
  });

  return showView(
    envelope,
    deps,
    {
      items,
      caption: acrossShares,
      senders: [...new Set(items.map((item) => item.senderName).filter(Boolean) as string[])],
      householdId,
      session: { kind: 'person', id: person.id, name: person.preferredName, index: 0 },
    },
    spoken,
  );
}

export async function handlePhotoNavigation(
  envelope: RequestEnvelope,
  deps: PhotoDeps,
  direction: 'next' | 'previous',
  householdId?: string | undefined,
): Promise<ResponseEnvelope> {
  const session = readSession(envelope);
  if (!session) {
    // With the microphone closed after a photo, "next" arrives as a fresh
    // invocation carrying no session, so Charlie cannot know what is on screen.
    // Showing the share is what the person meant; telling them to ask for the
    // pictures they are already looking at is not.
    if (householdId) return handleShowLatestPhotos(envelope, deps, householdId);
    return speak(noPhotoInView());
  }

  if (supportsApl(envelope) && deps.store) {
    // What is on screen is already on the device. Move it rather than
    // rebuilding it, and move it relative to the page the *device* is showing
    // -- so asking after swiping does what it says, and Charlie never has to
    // guess where someone's finger left the set. Nothing is spoken: the photo
    // is the answer, and narrating every swipe would be noise.
    return speak('', {
      keepSessionOpen: keepListening(envelope, deps),
      sessionAttributes: writeSession(session),
      directives: [movePhotoDirective(direction)],
    });
  }

  // Without a screen there is nothing to move, so Charlie walks the set and
  // says where it is. Never the vision description: it is written for search
  // and for someone who cannot see the photo, and reading "a child in a purple
  // swimsuit with raised arms" to a family who know the child is a case file.
  const view = await resolveView(deps, session, householdId);
  if (!view) return speak(emptyGallery());

  const wanted = direction === 'next' ? session.index + 1 : session.index - 1;
  if (wanted >= view.items.length) {
    return speak(endOfBatch(), { keepSessionOpen: true, sessionAttributes: writeSession(session) });
  }
  if (wanted < 0) {
    return speak(startOfBatch(), {
      keepSessionOpen: true,
      sessionAttributes: writeSession(session),
    });
  }

  return speak(positionLabel(wanted, view.items.length) ?? '', {
    keepSessionOpen: true,
    sessionAttributes: writeSession({ ...session, index: wanted }),
  });
}

/** "Who sent these?" and "when did she send them?" about what is showing. */
export async function handlePhotoQuestion(
  envelope: RequestEnvelope,
  deps: PhotoDeps,
  question: 'sender' | 'when',
  householdId?: string | undefined,
): Promise<ResponseEnvelope> {
  const session = readSession(envelope);
  if (!session) return speak(noPhotoInView());

  const view = await resolveView(deps, session, householdId);
  if (!view) return speak(emptyGallery());

  const attributes = writeSession(session);
  const them = view.items.length === 1 ? 'it' : 'them';
  const options = { keepSessionOpen: keepListening(envelope, deps), sessionAttributes: attributes };

  if (question === 'sender') {
    // A person's photos can come from several shares and several people, and
    // naming only the first would be a quiet lie.
    if (view.senders.length === 1) return speak(`${view.senders[0]} sent ${them}.`, options);
    if (view.senders.length === 0) return speak(`I'm not sure who sent ${them}.`, options);
    return speak(`A few people did: ${listOf(view.senders)}.`, options);
  }

  const timezone = await findHouseholdTimezone(deps.db, view.householdId);
  const days = new Set(view.items.map((item) => item.sharedAt.getTime()));
  if (days.size > 1 && view.session.kind === 'person') {
    return speak(`They were shared at different times.`, options);
  }

  const when = sharedWhen(view.items[0]!.sharedAt, new Date(), timezone);
  const who = view.senders.length === 1 ? view.senders[0] : 'They were';
  return speak(
    view.senders.length === 1 ? `${who} sent ${them} ${when}.` : `${who} shared ${when}.`,
    options,
  );
}

/**
 * The line under a photo gathered by person rather than by share.
 *
 * Its own words if it has any, otherwise who sent it -- never the caption of
 * the share it happened to arrive in, which may be about somebody else
 * entirely. The spoken answer has already said whose pictures these are.
 */
function acrossShares(item: GalleryItem): string {
  return photoCaption(item, {
    senderName: item.senderName ?? 'the family',
    caption: null,
    summary: null,
  });
}

/** "Jenna and Hannah", "Jenna, Hannah and JT". */
function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

import type { RequestEnvelope } from 'ask-sdk-model';

/**
 * Echo Show presentation.
 *
 * The photograph fills the screen and drifts slowly across it. Deliberately one
 * photo, one line of context, and a position marker -- the family photo is the
 * hero; anything else competes with it. Large type and high contrast because
 * the person looking at it may be the reason Charlie exists.
 *
 * An earlier version matted each photo like a print, on a stack. It looked
 * considered and it was worse: on a small Echo Show a portrait photograph
 * fitted inside a landscape matte is a stamp surrounded by white, and a swipe
 * slid the whole card sideways, which is a carousel pretending to be a pile.
 * Chrome that has to be justified is chrome that should not be there.
 */

export const APL_INTERFACE = 'Alexa.Presentation.APL';
/**
 * Pinned low on purpose. Everything here -- Container, Frame, Pager, Image,
 * Text, AnimateItem -- has existed since early APL, so asking for a recent
 * runtime buys nothing and excludes older Echo Shows, which fail by rendering
 * the container and dropping its contents. A blank screen, with no error.
 */
export const APL_DOCUMENT_VERSION = '1.6';

/** The document is addressed by this when a later turn moves the stack. */
export const PHOTO_TOKEN = 'charlie-photo';
export const PAGER_ID = 'photoStack';

/**
 * Charlie's colours, in one place.
 *
 * A single deep tone rather than a palette: every photo brings its own colours,
 * and a screen that competes with them is a screen that makes the family look
 * worse. Change `BRAND_BACKGROUND` and the whole presentation follows.
 */
const BRAND_BACKGROUND = '#1C3B47';
/** The matte of a print, for the uncropped presentation. */
const MATTE = '#FFFFFF';
const CAPTION_TEXT = '#F4F1EA';
const POSITION_TEXT = '#A9BCC4';

/**
 * Spacing as literal dimensions, never `@resource` references.
 *
 * A resource reference only resolves if the document defines it or imports a
 * package that does. An unresolved one reaches the device as the literal string
 * where a dimension belongs, and the component silently fails to inflate.
 */
const EDGE_PADDING = '28dp';
const MATTE_PADDING = '14dp';

/**
 * The slow drift across a still photograph.
 *
 * Long and shallow on purpose: a family photo on a kitchen counter should feel
 * alive, not animated. The zoom is small enough that nobody watches it happen,
 * and the movement is mostly vertical, which on a portrait photo cropped to a
 * landscape screen gradually reveals the parts that were cut off.
 */
const DRIFT_MS = 20_000;
const DRIFT_FROM = [{ scale: 1.0 }, { translateY: '0vh' }];
const DRIFT_TO = [{ scale: 1.16 }, { translateY: '-4vh' }];

/**
 * How a photo meets the screen.
 *
 * `cover` fills the screen and crops what does not fit, which is what a
 * photograph on a small display wants: big. `contain` shows the whole
 * photograph, matted, which is honest to the framing but small.
 */
export type PhotoFit = 'contain' | 'cover';

export const DEFAULT_PHOTO_FIT: PhotoFit = 'cover';

/** Screen support is progressive enhancement, never a requirement. */
export function supportsApl(envelope: RequestEnvelope): boolean {
  const interfaces = envelope.context?.System?.device?.supportedInterfaces as
    | Record<string, unknown>
    | undefined;
  return Boolean(interfaces && APL_INTERFACE in interfaces);
}

export interface PhotoSlide {
  /** Short-lived signed URL. HTTPS only -- devices reject http. */
  imageUrl: string;
  /** "2 of 6", omitted for a single photo. */
  position?: string | undefined;
}

export interface PhotoStack {
  slides: PhotoSlide[];
  /** "Jenna: Natalie at the beach" -- the human's words where possible. */
  caption: string;
  fit?: PhotoFit | undefined;
  /** The slow drift. Defaults to on; off is a real accessibility preference. */
  motion?: boolean | undefined;
}

/**
 * Starts the drift on one photograph.
 *
 * Attached to each image rather than driven from the document, so a page that
 * the Pager builds later still moves, and so the animation targets exactly the
 * photo it belongs to.
 */
function driftCommands(id: string): unknown[] {
  return [
    {
      type: 'AnimateItem',
      componentId: id,
      duration: DRIFT_MS,
      easing: 'ease-in-out',
      // Reverses rather than restarting: a photo that snapped back to where it
      // started would draw the eye to the animation instead of the face.
      repeatCount: 60,
      repeatMode: 'reverse',
      value: [{ property: 'transform', from: DRIFT_FROM, to: DRIFT_TO }],
    },
  ];
}

function captionBlock(
  caption: string,
  position: string | undefined,
  options: { onScrim: boolean },
): unknown {
  return {
    type: 'Container',
    ...(options.onScrim
      ? {
          position: 'absolute',
          bottom: '0dp',
          left: '0dp',
          // The caption sits on the photograph, so it needs its own ground.
          backgroundColor: 'rgba(0,0,0,0.58)',
        }
      : { paddingTop: '16dp' }),
    width: '100vw',
    paddingLeft: EDGE_PADDING,
    paddingRight: EDGE_PADDING,
    paddingTop: options.onScrim ? '20dp' : '16dp',
    paddingBottom: options.onScrim ? '20dp' : '0dp',
    alignItems: options.onScrim ? 'start' : 'center',
    items: [
      {
        type: 'Text',
        text: caption,
        fontSize: '34dp',
        fontWeight: '500',
        color: CAPTION_TEXT,
        maxLines: 2,
        ...(options.onScrim ? {} : { textAlign: 'center' }),
      },
      ...(position
        ? [
            {
              type: 'Text',
              text: position,
              fontSize: '24dp',
              color: POSITION_TEXT,
              paddingTop: '6dp',
              ...(options.onScrim ? {} : { textAlign: 'center' }),
            },
          ]
        : []),
    ],
  };
}

/** Edge to edge, cropped to fill, drifting slowly. */
function filledPage(
  slide: PhotoSlide,
  caption: string,
  index: number,
  motion: boolean,
): unknown {
  const id = `photo${index}`;
  return {
    type: 'Container',
    width: '100%',
    height: '100%',
    backgroundColor: BRAND_BACKGROUND,
    items: [
      {
        type: 'Image',
        id,
        source: slide.imageUrl,
        width: '100vw',
        height: '100vh',
        scale: 'best-fill',
        align: 'center',
        ...(motion ? { onMount: driftCommands(id) } : {}),
      },
      captionBlock(caption, slide.position, { onScrim: true }),
    ],
  };
}

/** The whole photograph, matted like a print. Honest framing, smaller photo. */
function mattedPage(slide: PhotoSlide, caption: string): unknown {
  return {
    type: 'Container',
    width: '100%',
    height: '100%',
    backgroundColor: BRAND_BACKGROUND,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: EDGE_PADDING,
    paddingBottom: EDGE_PADDING,
    items: [
      {
        type: 'Frame',
        width: '86vw',
        height: '62vh',
        backgroundColor: MATTE,
        borderRadius: '4dp',
        paddingLeft: MATTE_PADDING,
        paddingRight: MATTE_PADDING,
        paddingTop: MATTE_PADDING,
        paddingBottom: MATTE_PADDING,
        items: [
          {
            type: 'Image',
            source: slide.imageUrl,
            width: '100%',
            height: '100%',
            scale: 'best-fit',
            align: 'center',
          },
        ],
      },
      captionBlock(caption, slide.position, { onScrim: false }),
    ],
  };
}

/**
 * The document, with the share's values written straight into it.
 *
 * No `datasources`, and no `${...}` bindings. Charlie builds a document per
 * request, so the template indirection bought nothing and could only fail --
 * a binding that does not resolve renders as empty rather than as an error,
 * which on a device is indistinguishable from a photo that would not load.
 */
export function photoDocument(stack: PhotoStack): Record<string, unknown> {
  const fit = stack.fit ?? DEFAULT_PHOTO_FIT;
  const motion = stack.motion ?? true;

  return {
    type: 'APL',
    version: APL_DOCUMENT_VERSION,
    mainTemplate: {
      items: [
        {
          type: 'Pager',
          id: PAGER_ID,
          width: '100vw',
          height: '100vh',
          initialPage: 0,
          // The last photo returns to the first.
          navigation: stack.slides.length > 1 ? 'wrap' : 'none',
          items: stack.slides.map((slide, index) =>
            fit === 'cover'
              ? filledPage(slide, stack.caption, index, motion)
              : mattedPage(slide, stack.caption),
          ),
        },
      ],
    },
  };
}

/** The directive Alexa needs to render a share. */
export function renderPhotoDirective(stack: PhotoStack): Record<string, unknown> {
  return {
    type: 'Alexa.Presentation.APL.RenderDocument',
    token: PHOTO_TOKEN,
    document: photoDocument(stack),
  };
}

/**
 * Moves to the next photograph without re-rendering.
 *
 * Relative to the page the *device* is showing, not to anything the server
 * remembers -- so a photo reached by swiping and a photo reached by asking are
 * the same photo, and "next" after three swipes does what it says.
 */
export function movePhotoDirective(direction: 'next' | 'previous'): Record<string, unknown> {
  return {
    type: 'Alexa.Presentation.APL.ExecuteCommands',
    token: PHOTO_TOKEN,
    commands: [
      {
        type: 'SetPage',
        componentId: PAGER_ID,
        position: 'relative',
        value: direction === 'next' ? 1 : -1,
      },
    ],
  };
}

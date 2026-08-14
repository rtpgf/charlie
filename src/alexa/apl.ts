import type { RequestEnvelope } from 'ask-sdk-model';

/**
 * Echo Show presentation.
 *
 * A share is one stack of photographs: the top one is matted like a print, the
 * edges of the ones behind it show, and a swipe moves through them. Deliberately
 * one photo, one line of context, and a position marker -- the family photo is
 * the hero; anything else competes with it. Large type and high contrast
 * because the person looking at it may be the reason Charlie exists.
 */

export const APL_INTERFACE = 'Alexa.Presentation.APL';
/**
 * Pinned low on purpose. Everything here -- Container, Frame, Pager, Image,
 * Text -- has existed since early APL, so asking for a recent runtime buys
 * nothing and excludes older Echo Shows, which fail by rendering the container
 * and dropping its contents. A blank screen, with no error.
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
/** The matte of a print. White because that is what a photograph sits in. */
const MATTE = '#FFFFFF';
const CAPTION_TEXT = '#F4F1EA';
/** On the matte, so it is dark. Reads as a note on the border of a print. */
const MATTE_TEXT = '#6B7B82';
const POSITION_TEXT = '#A9BCC4';

/**
 * Spacing as literal dimensions, never `@resource` references.
 *
 * A resource reference only resolves if the document defines it or imports a
 * package that does. An unresolved one reaches the device as the literal string
 * where a dimension belongs, and the component silently fails to inflate.
 */
const EDGE_PADDING = '32dp';
/** The white margin around the photo, as on a print. */
const MATTE_PADDING = '16dp';

/** The stack sits in a fixed area, so the caption never moves between photos. */
const CARD_WIDTH = '70vw';
const CARD_HEIGHT = '54vh';
const STACK_WIDTH = '76vw';
const STACK_HEIGHT = '58vh';

/**
 * How a photo meets the screen.
 *
 * `contain` shows the whole photograph, which is the point of a family photo --
 * a face cropped out of frame is worse than a smaller face. `cover` fills the
 * screen and crops whatever does not fit.
 */
export type PhotoFit = 'contain' | 'cover';

export const DEFAULT_PHOTO_FIT: PhotoFit = 'contain';

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
}

/**
 * One page: the photograph, matted, with its position written on the border.
 *
 * The position lives inside the page rather than under the stack so that a
 * swipe updates it. Nothing else has to know which photo is showing -- not the
 * server, and not a session attribute.
 */
function mattedPage(slide: PhotoSlide): unknown {
  return {
    type: 'Frame',
    width: '100%',
    height: '100%',
    backgroundColor: MATTE,
    borderRadius: '4dp',
    paddingLeft: MATTE_PADDING,
    paddingRight: MATTE_PADDING,
    paddingTop: MATTE_PADDING,
    paddingBottom: MATTE_PADDING,
    items: [
      {
        type: 'Container',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        items: [
          {
            type: 'Image',
            source: slide.imageUrl,
            width: '100%',
            height: slide.position ? '86%' : '100%',
            // Fits the whole photograph inside the matte without cropping it.
            scale: 'best-fit',
            align: 'center',
          },
          ...(slide.position
            ? [
                {
                  type: 'Text',
                  text: slide.position,
                  fontSize: '22dp',
                  color: MATTE_TEXT,
                  textAlign: 'center',
                  paddingTop: '8dp',
                },
              ]
            : []),
        ],
      },
    ],
  };
}

/** An empty card, offset and tilted, so the stack reads as a pile. */
function backCard(options: { left: string; top: string; rotate: number }): unknown {
  return {
    type: 'Frame',
    position: 'absolute',
    left: options.left,
    top: options.top,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: MATTE,
    borderRadius: '4dp',
    // Ignored by runtimes that predate transforms, which costs nothing: the
    // card still reads as a card behind the photo, just square to it.
    transform: [{ rotate: options.rotate }],
    shadowColor: '#00000055',
    shadowRadius: '12dp',
    shadowVerticalOffset: '4dp',
  };
}

/** The whole photograph, matted like a print, on Charlie's background. */
function stacked(stack: PhotoStack): unknown {
  const many = stack.slides.length > 1;
  return {
    type: 'Container',
    width: '100vw',
    height: '100vh',
    backgroundColor: BRAND_BACKGROUND,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: EDGE_PADDING,
    paddingBottom: EDGE_PADDING,
    items: [
      {
        type: 'Container',
        width: STACK_WIDTH,
        height: STACK_HEIGHT,
        alignItems: 'center',
        justifyContent: 'center',
        items: [
          // Only hinted at when there is actually more than one photograph.
          ...(many
            ? [
                backCard({ left: '0dp', top: '10dp', rotate: -3 }),
                backCard({ left: '18dp', top: '5dp', rotate: 2 }),
              ]
            : []),
          {
            type: 'Pager',
            id: PAGER_ID,
            position: 'absolute',
            left: '9dp',
            top: '0dp',
            width: CARD_WIDTH,
            height: CARD_HEIGHT,
            initialPage: 0,
            // The top photograph goes to the bottom of the stack.
            navigation: many ? 'wrap' : 'none',
            items: stack.slides.map(mattedPage),
          },
        ],
      },
      {
        type: 'Container',
        width: '100vw',
        paddingLeft: EDGE_PADDING,
        paddingRight: EDGE_PADDING,
        paddingTop: '18dp',
        alignItems: 'center',
        items: [
          {
            type: 'Text',
            text: stack.caption,
            fontSize: '34dp',
            fontWeight: '500',
            color: CAPTION_TEXT,
            textAlign: 'center',
            maxLines: 2,
          },
        ],
      },
    ],
  };
}

/** Edge to edge, cropping whatever does not fit. Caption over a scrim. */
function fullBleedPage(slide: PhotoSlide, caption: string): unknown {
  return {
    type: 'Container',
    width: '100%',
    height: '100%',
    backgroundColor: BRAND_BACKGROUND,
    items: [
      {
        type: 'Image',
        source: slide.imageUrl,
        width: '100vw',
        height: '100vh',
        scale: 'best-fill',
        align: 'center',
      },
      {
        // The caption needs a scrim here, because it sits on the photograph.
        type: 'Container',
        position: 'absolute',
        bottom: '0dp',
        left: '0dp',
        width: '100vw',
        paddingLeft: EDGE_PADDING,
        paddingRight: EDGE_PADDING,
        paddingBottom: EDGE_PADDING,
        paddingTop: EDGE_PADDING,
        backgroundColor: 'rgba(0,0,0,0.62)',
        items: [
          {
            type: 'Text',
            text: caption,
            fontSize: '38dp',
            fontWeight: '500',
            color: CAPTION_TEXT,
            maxLines: 2,
          },
          ...(slide.position
            ? [
                {
                  type: 'Text',
                  text: slide.position,
                  fontSize: '26dp',
                  color: POSITION_TEXT,
                  paddingTop: '8dp',
                },
              ]
            : []),
        ],
      },
    ],
  };
}

function filled(stack: PhotoStack): unknown {
  return {
    type: 'Pager',
    id: PAGER_ID,
    width: '100vw',
    height: '100vh',
    initialPage: 0,
    navigation: stack.slides.length > 1 ? 'wrap' : 'none',
    items: stack.slides.map((slide) => fullBleedPage(slide, stack.caption)),
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
  return {
    type: 'APL',
    version: APL_DOCUMENT_VERSION,
    mainTemplate: {
      items: [fit === 'cover' ? filled(stack) : stacked(stack)],
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
 * Moves the stack without re-rendering it.
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

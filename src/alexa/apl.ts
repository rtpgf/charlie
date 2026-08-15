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

/**
 * How much larger than the screen the photograph is laid out.
 *
 * This is what makes it a pan rather than a zoom. `best-fill` crops the image
 * *inside* its component, so scaling that component only magnifies the crop --
 * the parts that were cut off are gone and no amount of translating brings them
 * back. Laying the image out half again as large along one axis and sliding it
 * across the screen shows those parts instead.
 */
const OVERSCAN = 1.5;

/**
 * The share of the component's own length that the pan travels.
 *
 * At 1.5x overscan, one third of the component hangs off the screen, so a third
 * of travel goes exactly from one edge to the other. Slightly less, so the pan
 * eases to a stop rather than arriving at the boundary.
 */
const TRAVEL_PERCENT = 30;

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
  /** Width over height. Absent means the photo is shown still. */
  aspect?: number | null | undefined;
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
 * A crossfade between photographs, in place of the default slide.
 *
 * A slide announces the mechanism -- you watch a card move across the screen. A
 * fade leaves the eye where it already is, on the face, which is how the Echo
 * Show shows its own artwork and how a photo frame behaves.
 *
 * Only the incoming photograph is touched, and it ends at full opacity, which
 * is exactly what APL requires of `event.nextChild` when the move completes.
 * Fading the outgoing one instead would leave a page sitting at zero opacity,
 * invisible, for whenever someone came back to it.
 */
const CROSSFADE = [
  {
    // The incoming photograph fades in over the one being left.
    drawOrder: 'nextAbove',
    commands: [
      {
        // SetValue is one of the few commands that runs during a page move,
        // which happens at frame rate and so in fast mode.
        type: 'SetValue',
        componentId: '${event.nextChild.uid}',
        property: 'opacity',
        value: '${event.amount}',
      },
    ],
  },
];

/** One pan at a time: starting a new one cancels the one being left. */
const PAN_SEQUENCER = 'photoPan';

/** Starts the drift on one photograph. */
function driftCommand(id: string, axis: 'x' | 'y'): Record<string, unknown> {
  const from = axis === 'y' ? { translateY: '0%' } : { translateX: '0%' };
  const to =
    axis === 'y'
      ? { translateY: `-${TRAVEL_PERCENT}%` }
      : { translateX: `-${TRAVEL_PERCENT}%` };
  return {
    type: 'AnimateItem',
    componentId: id,
    // Names a sequencer so a page change can start it. A fast-mode command with
    // an explicit sequencer runs in normal mode on that sequencer rather than
    // being skipped -- without this, a swipe leaves the photo frozen.
    sequencer: PAN_SEQUENCER,
    duration: DRIFT_MS,
    easing: 'ease-in-out',
    // Reverses rather than restarting: a photo that snapped back to where it
    // started would draw the eye to the animation instead of the face.
    repeatCount: 60,
    repeatMode: 'reverse',
    // Percentages, never viewport units. translateX/translateY take absolute
    // dimensions or a percentage of the component; a `vh` value is not one
    // APL accepts here, and one invalid entry drops the whole transform --
    // so the photo simply sits there, with nothing reported anywhere.
    value: [{ property: 'transform', from: [from], to: [to] }],
  };
}

/**
 * Restarts the pan whenever a different photograph comes into view.
 *
 * A page change driven by a swipe runs its commands in *fast mode*, where
 * `AnimateItem` jumps to its end state and `SendEvent` is ignored outright --
 * so the photo arrives frozen, and the device cannot even ask the skill to
 * animate it. The way out is `sequencer`: a fast-mode command that names one
 * runs in normal mode on that sequencer instead, which is the only reason this
 * animates at all.
 *
 * Naming the same sequencer for every page is deliberate. A sequencer runs one
 * command at a time, so arriving at a new photograph cancels the pan on the one
 * being left, rather than leaving animations running on photos nobody is
 * looking at.
 */
function pageChangedCommands(slides: PhotoSlide[]): unknown[] {
  return slides.flatMap((slide, index) => {
    const pan = panFor(slide.aspect);
    if (!pan) return [];
    return [
      {
        ...driftCommand(`photo${index}`, pan.axis),
        when: `\${event.source.value == ${index}}`,
      },
    ];
  });
}

/**
 * Which way a photograph pans, and how it is laid out to allow it.
 *
 * Along its long axis: a portrait photo on a landscape screen has its top and
 * bottom cropped away, so panning down is what reveals them. Unmeasured photos
 * do not pan at all -- a guess here crops the wrong edge off every photo in a
 * share, which is worse than stillness.
 */
function panFor(aspect: number | null | undefined): {
  axis: 'x' | 'y';
  width: string;
  height: string;
  align: string;
} | null {
  if (!aspect || !Number.isFinite(aspect)) return null;
  const over = `${OVERSCAN * 100}%`;
  return aspect < 1
    ? { axis: 'y', width: '100%', height: over, align: 'top' }
    : { axis: 'x', width: over, height: '100%', align: 'left' };
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
  const pan = motion ? panFor(slide.aspect) : null;

  return {
    type: 'Container',
    width: '100%',
    height: '100%',
    backgroundColor: BRAND_BACKGROUND,
    items: [
      pan
        ? {
            // Laid out larger than the screen along the photo's long axis, and
            // clipped to the page. Sliding it is what shows the cropped parts.
            type: 'Image',
            id,
            source: slide.imageUrl,
            width: pan.width,
            height: pan.height,
            scale: 'best-fill',
            align: pan.align,
            // Only the first page. The rest are started by the Pager when they
            // come into view -- see pageChangedCommands.
            ...(index === 0 ? { onMount: [driftCommand(id, pan.axis)] } : {}),
          }
        : {
            type: 'Image',
            id,
            source: slide.imageUrl,
            width: '100%',
            height: '100%',
            scale: 'best-fill',
            align: 'center',
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
          ...(stack.slides.length > 1 ? { handlePageMove: CROSSFADE } : {}),
          ...(fit === 'cover' && motion && stack.slides.length > 1
            ? { onPageChanged: pageChangedCommands(stack.slides) }
            : {}),
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

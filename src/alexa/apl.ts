import type { RequestEnvelope } from 'ask-sdk-model';

/**
 * Echo Show presentation.
 *
 * Deliberately one photo, one line of context, and a position marker. The
 * family photo is the hero; anything else competes with it. Large type and
 * high contrast because the person looking at it may be the reason Charlie
 * exists.
 */

export const APL_INTERFACE = 'Alexa.Presentation.APL';
/**
 * Pinned low on purpose. Everything here -- Container, Frame, Image, Text,
 * absolute positioning -- has existed since early APL, so asking for a recent
 * runtime buys nothing and excludes older Echo Shows, which fail by rendering
 * the container and dropping its contents. A blank screen, with no error.
 */
export const APL_DOCUMENT_VERSION = '1.6';

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
const MATTE_PADDING = '18dp';

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
  /** "Jenna sent these from the beach" -- the human's words where possible. */
  caption: string;
  /** "2 of 6", omitted for a single photo. */
  position?: string | undefined;
  /** Defaults to showing the whole photograph. */
  fit?: PhotoFit | undefined;
}

function captionLines(slide: PhotoSlide, options: { centred: boolean }): unknown[] {
  return [
    {
      type: 'Text',
      text: slide.caption,
      fontSize: '38dp',
      fontWeight: '500',
      color: CAPTION_TEXT,
      maxLines: 2,
      ...(options.centred ? { textAlign: 'center' } : {}),
    },
    // Omitted in JavaScript rather than with an APL `when`: one less expression
    // to evaluate on the device.
    ...(slide.position
      ? [
          {
            type: 'Text',
            text: slide.position,
            fontSize: '26dp',
            color: POSITION_TEXT,
            paddingTop: '8dp',
            ...(options.centred ? { textAlign: 'center' } : {}),
          },
        ]
      : []),
  ];
}

/**
 * The whole photograph, matted like a print against Charlie's background.
 *
 * The photo box is a fixed area and the image is fitted inside it, so a
 * portrait and a landscape photo both sit in a frame of the same size. That is
 * how a mounted print behaves, and it keeps the caption from moving between
 * photos in the same share.
 */
function framed(slide: PhotoSlide): unknown {
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
        type: 'Frame',
        backgroundColor: MATTE,
        borderRadius: '4dp',
        paddingLeft: MATTE_PADDING,
        paddingRight: MATTE_PADDING,
        paddingTop: MATTE_PADDING,
        paddingBottom: MATTE_PADDING,
        // Lifts the print off the background. Ignored by runtimes that predate
        // shadows, which costs nothing.
        shadowColor: '#00000066',
        shadowRadius: '18dp',
        shadowVerticalOffset: '6dp',
        items: [
          {
            type: 'Image',
            source: slide.imageUrl,
            width: '72vw',
            height: '52vh',
            // Fits the whole photograph inside the frame without cropping it.
            scale: 'best-fit',
            align: 'center',
          },
        ],
      },
      {
        type: 'Container',
        width: '100vw',
        paddingLeft: EDGE_PADDING,
        paddingRight: EDGE_PADDING,
        paddingTop: '20dp',
        alignItems: 'center',
        items: captionLines(slide, { centred: true }),
      },
    ],
  };
}

/** Edge to edge, cropping whatever does not fit. Caption over a scrim. */
function fullBleed(slide: PhotoSlide): unknown {
  return {
    type: 'Container',
    width: '100vw',
    height: '100vh',
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
        items: captionLines(slide, { centred: false }),
      },
    ],
  };
}

/**
 * The document, with this slide's values written straight into it.
 *
 * No `datasources`, and no `${...}` bindings. Charlie builds a document per
 * request, so the template indirection bought nothing and could only fail --
 * a binding that does not resolve renders as empty rather than as an error,
 * which on a device is indistinguishable from a photo that would not load.
 */
export function photoDocument(slide: PhotoSlide): Record<string, unknown> {
  const fit = slide.fit ?? DEFAULT_PHOTO_FIT;
  return {
    type: 'APL',
    version: APL_DOCUMENT_VERSION,
    mainTemplate: {
      items: [fit === 'cover' ? fullBleed(slide) : framed(slide)],
    },
  };
}

/** The directive Alexa needs to render a slide. */
export function renderPhotoDirective(slide: PhotoSlide): Record<string, unknown> {
  return {
    type: 'Alexa.Presentation.APL.RenderDocument',
    token: 'charlie-photo',
    document: photoDocument(slide),
  };
}

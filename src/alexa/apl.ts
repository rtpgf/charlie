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
 * Pinned low on purpose. Everything here -- Container, Image, Text, absolute
 * positioning -- has existed since early APL, so asking for a recent runtime
 * buys nothing and excludes older Echo Shows, which fail by rendering the
 * container and dropping its contents. A blank screen, with no error.
 */
export const APL_DOCUMENT_VERSION = '1.6';

/**
 * Spacing as literal dimensions, never `@resource` references.
 *
 * A resource reference only resolves if the document defines it or imports a
 * package that does. An unresolved one reaches the device as the literal string
 * where a dimension belongs, and the component silently fails to inflate.
 */
const EDGE_PADDING = '32dp';

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
  return {
    type: 'APL',
    version: APL_DOCUMENT_VERSION,
    mainTemplate: {
      items: [
        {
          type: 'Container',
          width: '100vw',
          height: '100vh',
          // Dark ground so the photograph carries the brightness.
          backgroundColor: '#141414',
          items: [
            {
              type: 'Image',
              source: slide.imageUrl,
              width: '100vw',
              height: '100vh',
              // Fills the screen without distorting the photo.
              scale: 'best-fill',
              align: 'center',
            },
            {
              // Caption sits over the photo's lower edge, on a scrim so it stays
              // readable whatever the photo underneath is doing.
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
                  text: slide.caption,
                  fontSize: '42dp',
                  fontWeight: '500',
                  color: '#FFFFFF',
                  maxLines: 2,
                },
                // Omitted in JavaScript rather than with an APL `when`, for the
                // same reason: one less expression to evaluate on the device.
                ...(slide.position
                  ? [
                      {
                        type: 'Text',
                        text: slide.position,
                        fontSize: '30dp',
                        color: '#D8D8D8',
                        paddingTop: '8dp',
                      },
                    ]
                  : []),
              ],
            },
          ],
        },
      ],
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

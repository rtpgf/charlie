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
export const APL_DOCUMENT_VERSION = '2023.2';

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

export function photoDocument(): Record<string, unknown> {
  return {
    type: 'APL',
    version: APL_DOCUMENT_VERSION,
    mainTemplate: {
      parameters: ['payload'],
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
              source: '${payload.slide.imageUrl}',
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
              bottom: '0',
              width: '100vw',
              paddingLeft: '@spacingLarge',
              paddingRight: '@spacingLarge',
              paddingBottom: '@spacingLarge',
              paddingTop: '@spacingLarge',
              backgroundColor: 'rgba(0,0,0,0.62)',
              items: [
                {
                  type: 'Text',
                  text: '${payload.slide.caption}',
                  fontSize: '42dp',
                  fontWeight: '500',
                  color: '#FFFFFF',
                  maxLines: 2,
                },
                {
                  type: 'Text',
                  text: '${payload.slide.position}',
                  fontSize: '30dp',
                  color: '#D8D8D8',
                  paddingTop: '8dp',
                  when: '${payload.slide.position != null}',
                },
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
    document: photoDocument(),
    datasources: { payload: { slide } },
  };
}

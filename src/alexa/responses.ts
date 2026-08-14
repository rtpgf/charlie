import type { ResponseEnvelope } from 'ask-sdk-model';

/**
 * Minimal Alexa response envelope builders.
 *
 * Alexa speaks `outputSpeech`. We use SSML because it is the current
 * recommended format and gives us room to shape delivery later without
 * changing the response shape.
 */

function escapeSsml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface SpeakOptions {
  /** Card title/body shown in the Alexa app. Omit for no card. */
  cardTitle?: string;
  /** Keep the microphone open for a follow-up. Defaults to false. */
  keepSessionOpen?: boolean;
  /** APL directives, for devices with a screen. Omitted otherwise. */
  directives?: Record<string, unknown>[] | undefined;
  /** Carried across turns so "next" knows which photo is in view. */
  sessionAttributes?: Record<string, unknown> | undefined;
}

export function speak(text: string, options: SpeakOptions = {}): ResponseEnvelope {
  return {
    version: '1.0',
    response: {
      outputSpeech: {
        type: 'SSML',
        ssml: `<speak>${escapeSsml(text)}</speak>`,
      },
      ...(options.cardTitle
        ? { card: { type: 'Simple' as const, title: options.cardTitle, content: text } }
        : {}),
      // ask-sdk-model's Directive union does not include the APL directives,
      // which are documented separately by Amazon; the shape is checked where
      // it is built, in src/alexa/apl.ts.
      ...(options.directives?.length
        ? { directives: options.directives as unknown as ResponseEnvelope['response']['directives'] }
        : {}),
      shouldEndSession: !options.keepSessionOpen,
    },
    ...(options.sessionAttributes ? { sessionAttributes: options.sessionAttributes } : {}),
  };
}

/** An empty, valid envelope. Used for SessionEndedRequest, where Alexa ignores speech. */
export function silent(): ResponseEnvelope {
  return { version: '1.0', response: {} };
}

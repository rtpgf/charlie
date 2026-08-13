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
      shouldEndSession: !options.keepSessionOpen,
    },
  };
}

/** An empty, valid envelope. Used for SessionEndedRequest, where Alexa ignores speech. */
export function silent(): ResponseEnvelope {
  return { version: '1.0', response: {} };
}

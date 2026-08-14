import type { ResponseEnvelope } from 'ask-sdk-model';

import { config } from '../config.js';

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

/**
 * Charlie speaks in a named Polly voice rather than the device default.
 *
 * Charlie is a he in the family's language, and a skill inherits the device's
 * Alexa voice unless it says otherwise. One wrapper here rather than at each
 * call site, so no line of Charlie's can be written in a different voice by
 * accident. Set ALEXA_VOICE to '' to use the device voice.
 */
function inCharliesVoice(escaped: string): string {
  const voice = config.alexa.voice;
  // Polly voice names are plain letters. Anything else is a misconfiguration,
  // and it would be going into an SSML attribute, so it does not go in at all.
  if (!voice || !/^[A-Za-z]+$/.test(voice)) return escaped;
  return `<voice name="${voice}">${escaped}</voice>`;
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
        ssml: `<speak>${inCharliesVoice(escapeSsml(text))}</speak>`,
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

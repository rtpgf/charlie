import type { RequestEnvelope, ResponseEnvelope } from 'ask-sdk-model';

import { logger } from '../logger.js';
import { launchGreeting, unsupportedRequest } from '../services/greeting.js';
import { silent, speak } from './responses.js';

/**
 * Routes an Alexa request envelope to the service that authors the response.
 *
 * Deliberately a switch rather than a handler registry: there is one request
 * type to support today. Add cases here and keep the words in `services/`.
 */
export function handleAlexaRequest(envelope: RequestEnvelope): ResponseEnvelope {
  const request = envelope.request;

  switch (request.type) {
    case 'LaunchRequest':
      return speak(launchGreeting(), { cardTitle: 'Charlie' });

    case 'SessionEndedRequest':
      // Alexa does not speak a response to this; it is a notification only.
      logger.debug('session ended', { reason: request.reason });
      return silent();

    default:
      logger.warn('unsupported request type', {
        requestType: request.type,
        intent: request.type === 'IntentRequest' ? request.intent.name : undefined,
      });
      return speak(unsupportedRequest());
  }
}

/** Describes an inbound request for logs without including user content or tokens. */
export function describeRequest(envelope: RequestEnvelope): Record<string, unknown> {
  return {
    requestType: envelope.request.type,
    requestId: envelope.request.requestId,
    locale: envelope.request.locale,
    intent: envelope.request.type === 'IntentRequest' ? envelope.request.intent.name : undefined,
    newSession: envelope.session?.new,
  };
}

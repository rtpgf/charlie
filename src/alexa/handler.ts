import type { RequestEnvelope, ResponseEnvelope } from 'ask-sdk-model';

import type { Db } from '../db/index.js';
import { answerWhoIs, resolveHousehold } from '../group/service.js';
import { logger } from '../logger.js';
import {
  goodbye,
  helpMessage,
  launchGreeting,
  missingPersonName,
  unrecognizedAccount,
  unsupportedRequest,
} from '../services/speech.js';
import { silent, speak } from './responses.js';

export interface HandlerDeps {
  db: Db;
}

/** The slot carrying the person being asked about in WhoIsPersonIntent. */
const PERSON_NAME_SLOT = 'personName';

/**
 * Routes an Alexa request envelope to the service that answers it.
 *
 * Deliberately a switch rather than a handler registry: there are few request
 * types. Add cases here and keep domain logic in services.
 */
export async function handleAlexaRequest(
  envelope: RequestEnvelope,
  deps: HandlerDeps,
): Promise<ResponseEnvelope> {
  const request = envelope.request;

  switch (request.type) {
    case 'LaunchRequest':
      return speak(launchGreeting(), { cardTitle: 'Charlie' });

    case 'SessionEndedRequest':
      // Alexa does not speak a response to this; it is a notification only.
      logger.debug('session ended', { reason: request.reason });
      return silent();

    case 'IntentRequest':
      switch (request.intent.name) {
        case 'WhoIsPersonIntent':
          return handleWhoIsPerson(envelope, deps);

        case 'AMAZON.HelpIntent':
          return speak(helpMessage(), { keepSessionOpen: true });

        case 'AMAZON.StopIntent':
        case 'AMAZON.CancelIntent':
          return speak(goodbye());

        default:
          logger.warn('unsupported intent', { intent: request.intent.name });
          return speak(unsupportedRequest());
      }

    default:
      logger.warn('unsupported request type', { requestType: request.type });
      return speak(unsupportedRequest());
  }
}

async function handleWhoIsPerson(
  envelope: RequestEnvelope,
  deps: HandlerDeps,
): Promise<ResponseEnvelope> {
  const request = envelope.request;
  if (request.type !== 'IntentRequest') return speak(unsupportedRequest());

  const spokenName = request.intent.slots?.[PERSON_NAME_SLOT]?.value?.trim();
  if (!spokenName) {
    return speak(missingPersonName(), { keepSessionOpen: true });
  }

  const alexaUserId = alexaUserIdOf(envelope);
  if (!alexaUserId) {
    logger.warn('alexa request carried no user id');
    return speak(unrecognizedAccount());
  }

  const householdId = await resolveHousehold(deps.db, alexaUserId);
  if (!householdId) {
    // The id is logged here, and only here, because mapping a new device to a
    // household is a manual development step. See README "Alexa user mapping".
    logger.warn('no household mapped for alexa user', { alexaUserId });
    return speak(unrecognizedAccount());
  }

  const answer = await answerWhoIs(deps.db, householdId, spokenName);
  return speak(answer, { cardTitle: 'Charlie' });
}

function alexaUserIdOf(envelope: RequestEnvelope): string | undefined {
  return envelope.context?.System?.user?.userId ?? envelope.session?.user?.userId;
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

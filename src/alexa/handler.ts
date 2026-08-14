import type { RequestEnvelope, ResponseEnvelope } from 'ask-sdk-model';

import type { Db } from '../db/index.js';
import { answerWhoIs, resolveHousehold } from '../group/service.js';
import { describeAgenda, getEventsForLocalDate } from '../knowledge/agenda.js';
import { narrateAgenda } from '../knowledge/narrate.js';
import type { AgendaNarrator } from '../knowledge/types.js';
import { findHouseholdTimezone } from '../knowledge/repository.js';
import { instantToLocalDate } from '../knowledge/timezone.js';
import { logger } from '../logger.js';
import type { MediaStore } from '../media/store.js';
import type { MediaLinkConfig } from './photos.js';
import {
  handlePhotoNavigation,
  handlePhotoQuestion,
  handleShowLatestPhotos,
} from './photos.js';
import {
  goodbye,
  helpMessage,
  launchGreeting,
  missingAgendaDate,
  missingPersonName,
  unrecognizedAccount,
  unsupportedRequest,
} from '../services/speech.js';
import { silent, speak } from './responses.js';

export interface HandlerDeps {
  db: Db;
  /** Optional fluency pass over multi-event answers. */
  narrator?: AgendaNarrator | undefined;
  /** Signs short-lived URLs for Echo Show. Absent means voice-only. */
  store?: MediaStore | undefined;
  /** Serves photos from Charlie's own domain. Absent falls back to storage. */
  link?: MediaLinkConfig | undefined;
}

/** The slot carrying the person being asked about in WhoIsPersonIntent. */
const PERSON_NAME_SLOT = 'personName';

/** AMAZON.DATE slot on AgendaForDateIntent; Alexa normalizes it for us. */
const DATE_SLOT = 'date';

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

        case 'AgendaForDateIntent':
          return handleAgendaForDate(envelope, deps);

        case 'ShowLatestPicturesIntent': {
          const householdId = await householdFor(envelope, deps);
          if (!householdId) return speak(unrecognizedAccount());
          return handleShowLatestPhotos(envelope, deps, householdId);
        }

        // Navigation and questions read the photo in view from session state,
        // so they need no group lookup of their own.
        case 'AMAZON.NextIntent':
          return handlePhotoNavigation(envelope, deps, 'next');

        case 'AMAZON.PreviousIntent':
          return handlePhotoNavigation(envelope, deps, 'previous');

        case 'WhoSentThisIntent':
          return handlePhotoQuestion(envelope, deps, 'sender');

        case 'WhenWasThisSharedIntent':
          return handlePhotoQuestion(envelope, deps, 'when');

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

  const householdId = await householdFor(envelope, deps);
  if (!householdId) return speak(unrecognizedAccount());

  const answer = await answerWhoIs(deps.db, householdId, spokenName);
  return speak(answer, { cardTitle: 'Charlie' });
}

/**
 * "What's happening tomorrow?"
 *
 * Alexa's AMAZON.DATE slot already normalizes "tomorrow" / "today" / "next
 * Friday" to a calendar date, so no model is needed to read the question, and
 * none is used to answer it.
 */
async function handleAgendaForDate(
  envelope: RequestEnvelope,
  deps: HandlerDeps,
): Promise<ResponseEnvelope> {
  const request = envelope.request;
  if (request.type !== 'IntentRequest') return speak(unsupportedRequest());

  const householdId = await householdFor(envelope, deps);
  if (!householdId) return speak(unrecognizedAccount());

  const timezone = await findHouseholdTimezone(deps.db, householdId);
  const todayLocalDate = instantToLocalDate(new Date(), timezone);

  // Alexa also returns week ("2026-W33") and month ("2026-08") forms; only a
  // single day is supported, and anything else is declined rather than guessed.
  const slotValue = request.intent.slots?.[DATE_SLOT]?.value?.trim();
  const localDate = slotValue && /^\d{4}-\d{2}-\d{2}$/.test(slotValue) ? slotValue : undefined;

  if (!localDate) {
    if (slotValue) logger.warn('unsupported date slot granularity', { slotValue });
    // With no usable date, default to today rather than asking again.
    const events = await getEventsForLocalDate(deps.db, {
      householdId,
      timezone,
      localDate: todayLocalDate,
    });
    if (slotValue) return speak(missingAgendaDate());
    return speak(
      await answerFor(deps, events, {
        localDate: todayLocalDate,
        todayLocalDate,
        timezone,
      }),
      { cardTitle: 'Charlie' },
    );
  }

  const events = await getEventsForLocalDate(deps.db, { householdId, timezone, localDate });
  return speak(await answerFor(deps, events, { localDate, todayLocalDate, timezone }), {
    cardTitle: 'Charlie',
  });
}

/**
 * The deterministic sentence is always built, and is what Charlie says unless a
 * narrator both exists and returns something that passes validation.
 */
async function answerFor(
  deps: HandlerDeps,
  events: Awaited<ReturnType<typeof getEventsForLocalDate>>,
  options: { localDate: string; todayLocalDate: string; timezone: string },
): Promise<string> {
  const deterministic = describeAgenda(events, options);
  return narrateAgenda(events, deterministic, {
    timezone: options.timezone,
    narrator: deps.narrator,
  });
}

/** Resolves the Alexa account to a group, logging the id only when unmapped. */
async function householdFor(
  envelope: RequestEnvelope,
  deps: HandlerDeps,
): Promise<string | null> {
  const alexaUserId = alexaUserIdOf(envelope);
  if (!alexaUserId) {
    logger.warn('alexa request carried no user id');
    return null;
  }
  const householdId = await resolveHousehold(deps.db, alexaUserId);
  if (!householdId) {
    // Logged here, and only here, because mapping a new device to a group is a
    // manual development step. See README "Alexa user mapping".
    logger.warn('no household mapped for alexa user', { alexaUserId });
  }
  return householdId;
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

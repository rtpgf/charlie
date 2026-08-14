import { findPeopleByName, type GroupGraph, type Person } from '../group/graph.js';
import { localToInstant } from './timezone.js';
import {
  EXTRACTION_SCHEMA_VERSION,
  type DatePrecision,
  type EventConfidence,
  type EventStatus,
  type KnowledgeProposal,
  type ProposedEvent,
  type TimePrecision,
} from './types.js';

/**
 * The boundary between what a model proposed and what Charlie accepts.
 *
 * Everything here is pure and deterministic. A proposal is untrusted input:
 * its shape is re-checked, its people are resolved against the group's own
 * records, and its dates are converted using the group's timezone rather than
 * anything the model computed. Nothing reaches the database without passing.
 */

export interface ResolvedParticipant {
  person: Person | null;
  /** The name as written, kept when it could not be resolved. */
  name: string;
}

export interface AcceptedEvent {
  /** Resolved where possible, so speech can use Charlie's preferred name. */
  subject: ResolvedParticipant | null;
  activity: string;
  description: string | null;
  startsAt: Date | null;
  datePrecision: DatePrecision;
  timePrecision: TimePrecision;
  status: EventStatus;
  confidence: EventConfidence;
  participants: ResolvedParticipant[];
}

export interface ValidationResult {
  events: AcceptedEvent[];
  /** Why individual events were dropped. Empty when everything was accepted. */
  rejections: string[];
}

export class InvalidProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProposalError';
  }
}

const STATUSES: EventStatus[] = ['planned', 'tentative', 'cancelled'];
const CONFIDENCES: EventConfidence[] = ['explicit', 'inferred', 'uncertain'];
const DATE_PRECISIONS: DatePrecision[] = ['exact', 'day', 'unknown'];
const TIME_PRECISIONS: TimePrecision[] = ['exact', 'approximate', 'none'];

const MAX_ACTIVITY_LENGTH = 200;
/** Events implausibly far from the message date are treated as model error. */
const MAX_YEARS_FROM_MESSAGE = 2;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Re-checks the proposal's shape. The provider's schema already constrains it;
 * this exists so a different provider, a schema change, or a malformed response
 * cannot reach the rest of the system.
 */
export function assertWellFormed(value: unknown): asserts value is KnowledgeProposal {
  if (!value || typeof value !== 'object') {
    throw new InvalidProposalError('proposal is not an object');
  }
  const proposal = value as Record<string, unknown>;

  if (proposal['schemaVersion'] !== EXTRACTION_SCHEMA_VERSION) {
    throw new InvalidProposalError(
      `unsupported schema version: ${String(proposal['schemaVersion'])}`,
    );
  }
  for (const field of ['peopleMentioned', 'facts', 'relationships', 'uncertainties']) {
    if (!isStringArray(proposal[field])) {
      throw new InvalidProposalError(`${field} must be an array of strings`);
    }
  }
  if (!Array.isArray(proposal['events'])) {
    throw new InvalidProposalError('events must be an array');
  }
}

function validateEvent(
  raw: unknown,
  graph: GroupGraph,
  timezone: string,
  messageReceivedAt: Date,
): { event: AcceptedEvent } | { rejected: string } {
  if (!raw || typeof raw !== 'object') return { rejected: 'event is not an object' };
  const event = raw as Record<string, unknown>;

  const activity = event['activity'];
  if (typeof activity !== 'string' || activity.trim() === '') {
    return { rejected: 'event has no activity' };
  }
  if (activity.length > MAX_ACTIVITY_LENGTH) return { rejected: 'event activity too long' };

  const rawSubject = event['subject'];
  const subject =
    typeof rawSubject === 'string' && rawSubject.trim() !== ''
      ? resolveParticipant(graph, rawSubject)
      : null;

  const status = event['status'] as EventStatus;
  const confidence = event['confidence'] as EventConfidence;
  const datePrecision = event['datePrecision'] as DatePrecision;
  const timePrecision = event['timePrecision'] as TimePrecision;

  if (!STATUSES.includes(status)) return { rejected: `invalid status: ${String(status)}` };
  if (!CONFIDENCES.includes(confidence)) {
    return { rejected: `invalid confidence: ${String(confidence)}` };
  }
  if (!DATE_PRECISIONS.includes(datePrecision)) {
    return { rejected: `invalid datePrecision: ${String(datePrecision)}` };
  }
  if (!TIME_PRECISIONS.includes(timePrecision)) {
    return { rejected: `invalid timePrecision: ${String(timePrecision)}` };
  }

  // Charlie does the date arithmetic, using the group's timezone. The model
  // only reports the local date and time it understood.
  const localDate = event['localDate'];
  const localTime = event['localTime'];
  let startsAt: Date | null = null;

  if (typeof localDate === 'string' && localDate !== '') {
    const time = typeof localTime === 'string' && localTime !== '' ? localTime : '00:00';
    startsAt = localToInstant(localDate, time, timezone);
    if (!startsAt) return { rejected: `unparseable local date/time: ${localDate} ${time}` };

    const yearsAway =
      Math.abs(startsAt.getTime() - messageReceivedAt.getTime()) / (365 * 24 * 60 * 60 * 1000);
    if (yearsAway > MAX_YEARS_FROM_MESSAGE) {
      return { rejected: 'event date implausibly far from the message date' };
    }
  }

  if (startsAt === null && datePrecision !== 'unknown') {
    return { rejected: 'datePrecision claims a known date but none was given' };
  }

  const names = isStringArray(event['participants']) ? event['participants'] : [];

  return {
    event: {
      subject,
      activity: activity.trim(),
      description: typeof event['description'] === 'string' ? event['description'] : null,
      startsAt,
      datePrecision,
      timePrecision,
      status,
      confidence,
      participants: names.map((name) => resolveParticipant(graph, name)),
    },
  };
}

/**
 * Resolves a name against the group's own people and aliases. An ambiguous or
 * unknown name stays unresolved text -- Charlie never invents a person, and
 * never lets the model supply a database id.
 */
function resolveParticipant(graph: GroupGraph, name: string): ResolvedParticipant {
  const matches = findPeopleByName(graph, name);
  return { person: matches.length === 1 ? matches[0]! : null, name: name.trim() };
}

export function validateProposal(
  proposal: unknown,
  options: { graph: GroupGraph; timezone: string; messageReceivedAt: Date },
): ValidationResult {
  assertWellFormed(proposal);

  const events: AcceptedEvent[] = [];
  const rejections: string[] = [];

  for (const raw of proposal.events) {
    const outcome = validateEvent(raw, options.graph, options.timezone, options.messageReceivedAt);
    if ('event' in outcome) events.push(outcome.event);
    else rejections.push(outcome.rejected);
  }

  return { events, rejections };
}

import type { Db } from '../db/index.js';
import { formatLocalTime, instantToLocalDate, localDayBounds } from './timezone.js';
import type { EventStatus, TimePrecision } from './types.js';

/**
 * Reading structured knowledge back out, for Alexa.
 *
 * Deterministic end to end: the answer is assembled from stored rows, with no
 * model involved. Proving structured retrieval separately from generation is
 * the point of this milestone.
 */

export interface AgendaEvent {
  /** Who the event is about, or null when the message named no subject. */
  subject: string | null;
  /** Completes "<subject> is ___" or "you have ___". */
  activity: string;
  startsAt: Date | null;
  timePrecision: TimePrecision;
  status: EventStatus;
}

export async function getEventsForLocalDate(
  db: Db,
  input: { householdId: string; timezone: string; localDate: string },
): Promise<AgendaEvent[]> {
  const bounds = localDayBounds(input.localDate, input.timezone);
  if (!bounds) return [];

  const result = await db.query(
    `SELECT subject, activity, starts_at, time_precision, status
       FROM group_event
      WHERE household_id = $1
        AND status <> 'cancelled'
        AND superseded_by IS NULL
        AND starts_at >= $2 AND starts_at < $3
      -- Events with a stated time come first, in time order; ones with no time
      -- read better trailing the day's plan than heading it.
      ORDER BY (time_precision = 'none') ASC, starts_at ASC`,
    [input.householdId, bounds.start, bounds.end],
  );

  return result.rows.map((row) => ({
    subject: (row['subject'] as string | null) ?? null,
    activity: row['activity'] as string,
    startsAt: (row['starts_at'] as Date | null) ?? null,
    timePrecision: row['time_precision'] as TimePrecision,
    status: row['status'] as EventStatus,
  }));
}

/** "today" / "tomorrow" / "on Saturday", relative to the group's today. */
function dayPhrase(localDate: string, todayLocalDate: string, timezone: string): string {
  if (localDate === todayLocalDate) return 'today';

  const bounds = localDayBounds(todayLocalDate, timezone);
  if (bounds) {
    const tomorrow = instantToLocalDate(
      new Date(bounds.end.getTime() + 12 * 60 * 60 * 1000),
      timezone,
    );
    if (localDate === tomorrow) return 'tomorrow';
  }

  const parsed = localDayBounds(localDate, timezone);
  if (!parsed) return 'then';
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(
    parsed.start,
  );
  return `on ${weekday}`;
}

function timePhrase(event: AgendaEvent, timezone: string): string {
  if (!event.startsAt || event.timePrecision === 'none') return '';
  const time = formatLocalTime(event.startsAt, timezone);
  return event.timePrecision === 'approximate' ? ` around ${time}` : ` at ${time}`;
}

/**
 * Builds the clause. The model supplied the words; the grammar is Charlie's, so
 * certainty is carried by the verb rather than by a bolted-on adverb:
 *
 *   Jenna is coming over around 3 PM     /  Jenna might be coming over ...
 *   you have a dentist appointment at 4  /  you might have a dentist appointment ...
 */
function describeEvent(event: AgendaEvent, timezone: string): string {
  const tentative = event.status === 'tentative';
  const clause = event.subject
    ? `${event.subject} ${tentative ? 'might be' : 'is'} ${event.activity}`
    : `you ${tentative ? 'might have' : 'have'} ${event.activity}`;
  return `${clause}${timePhrase(event, timezone)}`;
}

/**
 * Each item here is a full clause with its own verb, so even two of them need a
 * comma before "and" — without it they run together into one sentence.
 */
function joinClauses(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

export function describeAgenda(
  events: AgendaEvent[],
  options: { localDate: string; todayLocalDate: string; timezone: string },
): string {
  const day = dayPhrase(options.localDate, options.todayLocalDate, options.timezone);

  if (events.length === 0) {
    return `I don't have anything saved for ${day} yet.`;
  }

  const described = events.map((event) => describeEvent(event, options.timezone));

  if (events.length === 1) {
    return `${capitalize(described[0]!)} ${day}.`;
  }

  return `${capitalize(day)}, ${joinClauses(described)}.`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

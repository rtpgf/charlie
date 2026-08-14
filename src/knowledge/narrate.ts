import { logger } from '../logger.js';
import type { AgendaEvent } from './agenda.js';
import { formatLocalTime } from './timezone.js';
import type { AgendaNarrator } from './types.js';

/**
 * Optional fluency pass over an agenda answer.
 *
 * The deterministic sentence is always built first and is always the fallback.
 * The model is asked only to rephrase facts Charlie already assembled, never to
 * decide what they are — and its output is checked before it is spoken, because
 * the failure mode that matters is a smooth sentence that quietly changes a
 * "might" into a "will".
 */

/** Rendering is only worth its latency when the sentence is actually awkward. */
export function needsNarration(events: AgendaEvent[]): boolean {
  return events.length > 1;
}

const TIME_PATTERN = /\b\d{1,2}(?::\d{2})?\s?(?:AM|PM)\b/gi;

/** Distinctive words from an activity, used to check it survived rephrasing. */
function contentWords(activity: string): string[] {
  const stop = new Set([
    'a', 'an', 'the', 'to', 'of', 'for', 'with', 'and', 'is', 'are', 'be', 'at',
    'on', 'in', 'over', 'by', 'up', 'out',
  ]);
  return activity
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stop.has(word));
}

export interface NarrationCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Everything the rendered sentence must satisfy before Charlie will say it.
 * Pure, so the rules are testable without a provider.
 */
export function checkNarration(
  candidate: string,
  events: AgendaEvent[],
  timezone: string,
): NarrationCheck {
  const text = candidate.trim();
  if (text === '') return { ok: false, reason: 'empty' };
  if (text.length > 400) return { ok: false, reason: 'too long' };

  const lower = text.toLowerCase();

  for (const event of events) {
    // Every event must still be recognizable in the output. Dropping one is the
    // easiest and least visible way for a rewrite to be wrong.
    if (event.subject && !lower.includes(event.subject.toLowerCase())) {
      return { ok: false, reason: `dropped subject: ${event.subject}` };
    }
    const words = contentWords(event.activity);
    if (words.length > 0 && !words.some((word) => lower.includes(word))) {
      return { ok: false, reason: `dropped activity: ${event.activity}` };
    }
  }

  // No invented clock times. Every time mentioned must be one Charlie holds.
  const expected = new Set(
    events
      .filter((event) => event.startsAt && event.timePrecision !== 'none')
      .map((event) => formatLocalTime(event.startsAt!, timezone).toLowerCase()),
  );
  for (const mentioned of text.match(TIME_PATTERN) ?? []) {
    if (!expected.has(mentioned.toLowerCase().replace(/\s+/g, ' '))) {
      return { ok: false, reason: `invented time: ${mentioned}` };
    }
  }

  // Uncertainty must survive. This is the failure CHARLIE.md cares about most:
  // a fluent rewrite turning "might" into a settled plan.
  if (events.some((event) => event.status === 'tentative')) {
    if (!/\b(might|maybe|possibly|may)\b/i.test(text)) {
      return { ok: false, reason: 'tentative event lost its uncertainty' };
    }
  }

  return { ok: true };
}

export async function narrateAgenda(
  events: AgendaEvent[],
  deterministic: string,
  options: { timezone: string; narrator?: AgendaNarrator | undefined },
): Promise<string> {
  if (!options.narrator || !needsNarration(events)) return deterministic;

  let candidate: string;
  try {
    candidate = await options.narrator.rephraseAgenda(deterministic);
  } catch (error: unknown) {
    logger.warn('agenda narration failed, using deterministic answer', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return deterministic;
  }

  const check = checkNarration(candidate, events, options.timezone);
  if (!check.ok) {
    logger.warn('agenda narration rejected, using deterministic answer', {
      reason: check.reason,
    });
    return deterministic;
  }

  return candidate;
}

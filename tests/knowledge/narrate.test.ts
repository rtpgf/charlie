import { describe, expect, it } from 'vitest';

import type { AgendaEvent } from '../../src/knowledge/agenda.js';
import { checkNarration, narrateAgenda, needsNarration } from '../../src/knowledge/narrate.js';
import type { AgendaNarrator } from '../../src/knowledge/types.js';

const TIMEZONE = 'America/Chicago';

function event(overrides: Partial<AgendaEvent> = {}): AgendaEvent {
  return {
    subject: 'Jenna',
    activity: 'coming over',
    startsAt: new Date('2026-08-15T20:00:00Z'), // 3 PM Chicago
    timePrecision: 'approximate',
    status: 'planned',
    ...overrides,
  };
}

const TWO_EVENTS = [
  event(),
  event({
    subject: 'Hannah',
    activity: 'coming over with Jenna',
    startsAt: new Date('2026-08-15T22:00:00Z'), // 5 PM Chicago
    status: 'tentative',
  }),
];

const DETERMINISTIC =
  'Tomorrow, Jenna is coming over around 3 PM, and Hannah might be coming over with Jenna at 5 PM.';

function narrator(sentence: string | Error): AgendaNarrator {
  return {
    provider: 'stub',
    model: 'stub-model',
    rephraseAgenda: async () => {
      if (sentence instanceof Error) throw sentence;
      return sentence;
    },
  };
}

describe('when narration runs at all', () => {
  it('skips a single-event answer', () => {
    expect(needsNarration([event()])).toBe(false);
  });

  it('skips an empty day', () => {
    expect(needsNarration([])).toBe(false);
  });

  it('runs for multiple events', () => {
    expect(needsNarration(TWO_EVENTS)).toBe(true);
  });

  it('never calls the narrator for a single event', async () => {
    let called = false;
    const spy: AgendaNarrator = {
      provider: 'stub',
      model: 'stub',
      rephraseAgenda: async () => {
        called = true;
        return 'rewritten';
      },
    };

    const answer = await narrateAgenda([event()], 'Jenna is coming over around 3 PM tomorrow.', {
      timezone: TIMEZONE,
      narrator: spy,
    });

    expect(called).toBe(false);
    expect(answer).toBe('Jenna is coming over around 3 PM tomorrow.');
  });
});

describe('validating a rewritten answer', () => {
  it('accepts a faithful rewrite', () => {
    const check = checkNarration(
      'Tomorrow Jenna is coming over around 3 PM, and Hannah might join her at 5 PM.',
      TWO_EVENTS,
      TIMEZONE,
    );

    expect(check.ok).toBe(true);
  });

  it('rejects a rewrite that drops an event', () => {
    const check = checkNarration('Tomorrow Jenna is coming over around 3 PM.', TWO_EVENTS, TIMEZONE);

    expect(check).toMatchObject({ ok: false, reason: 'dropped subject: Hannah' });
  });

  it('rejects a rewrite that invents a time', () => {
    const check = checkNarration(
      'Tomorrow Jenna is coming over around 3 PM, and Hannah might join her at 6 PM.',
      TWO_EVENTS,
      TIMEZONE,
    );

    expect(check.ok).toBe(false);
    expect(check.reason).toContain('invented time');
  });

  it('rejects a rewrite that turns a possibility into a plan', () => {
    const check = checkNarration(
      'Tomorrow Jenna and Hannah are both coming over, at 3 PM and 5 PM.',
      TWO_EVENTS,
      TIMEZONE,
    );

    expect(check).toMatchObject({ ok: false, reason: 'tentative event lost its uncertainty' });
  });

  it('rejects an empty rewrite', () => {
    expect(checkNarration('   ', TWO_EVENTS, TIMEZONE).ok).toBe(false);
  });

  it('rejects a rambling rewrite', () => {
    expect(checkNarration('x'.repeat(500), TWO_EVENTS, TIMEZONE).ok).toBe(false);
  });
});

describe('falling back', () => {
  it('uses the rewrite when it passes', async () => {
    const better = 'Tomorrow Jenna is coming over around 3 PM, and Hannah might join her at 5 PM.';

    const answer = await narrateAgenda(TWO_EVENTS, DETERMINISTIC, {
      timezone: TIMEZONE,
      narrator: narrator(better),
    });

    expect(answer).toBe(better);
  });

  it('falls back when the rewrite drops an event', async () => {
    const answer = await narrateAgenda(TWO_EVENTS, DETERMINISTIC, {
      timezone: TIMEZONE,
      narrator: narrator('Tomorrow Jenna is coming over around 3 PM.'),
    });

    expect(answer).toBe(DETERMINISTIC);
  });

  it('falls back when the provider fails', async () => {
    const answer = await narrateAgenda(TWO_EVENTS, DETERMINISTIC, {
      timezone: TIMEZONE,
      narrator: narrator(new Error('provider unavailable')),
    });

    expect(answer).toBe(DETERMINISTIC);
  });

  it('uses the deterministic answer when no narrator is configured', async () => {
    const answer = await narrateAgenda(TWO_EVENTS, DETERMINISTIC, { timezone: TIMEZONE });

    expect(answer).toBe(DETERMINISTIC);
  });
});

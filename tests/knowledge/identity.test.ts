import { describe, expect, it } from 'vitest';

import type { Db } from '../../src/db/index.js';
import { decideIdentity, type ExistingEvent } from '../../src/knowledge/identity.js';
import type { ActivityMatcher } from '../../src/knowledge/types.js';
import { ingestInboundMessage } from '../../src/messaging/service.js';
import { parseWhatsAppWebhook } from '../../src/messaging/whatsapp/parse.js';
import { createSeededTestDb } from '../helpers/db.js';
import { eventProposal, stubExtractor } from '../helpers/extractor.js';
import { textMessageWebhook, JENNA_WHATSAPP_ID } from '../helpers/whatsapp.js';
import type { AcceptedEvent } from '../../src/knowledge/validate.js';

function candidate(overrides: Partial<AcceptedEvent> = {}): AcceptedEvent {
  return {
    subject: { person: null, name: 'Hannah' },
    activity: 'coming over with Jenna',
    description: null,
    startsAt: new Date('2026-08-15T20:00:00Z'),
    datePrecision: 'day',
    timePrecision: 'approximate',
    status: 'planned',
    confidence: 'explicit',
    participants: [],
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingEvent> = {}): ExistingEvent {
  return {
    id: 'existing-1',
    activity: 'coming over with Jenna',
    startsAt: new Date('2026-08-15T20:00:00Z'),
    timePrecision: 'approximate',
    status: 'planned',
    ...overrides,
  };
}

/** Stands in for the AI judgement, so these tests stay deterministic. */
function matcher(answer: boolean): ActivityMatcher {
  return {
    provider: 'stub',
    model: 'stub-model',
    isSameActivity: async () => answer,
  };
}

const LOCAL_DATE = '2026-08-15';

describe('deciding whether two events are the same', () => {
  it('treats a restatement in different words as a duplicate', async () => {
    const decision = await decideIdentity(
      candidate({ activity: 'coming along with Jenna' }),
      existing({ activity: 'coming over with Jenna' }),
      { localDate: LOCAL_DATE, matcher: matcher(true) },
    );

    expect(decision.kind).toBe('duplicate');
  });

  it('treats an unrelated activity as distinct', async () => {
    const decision = await decideIdentity(
      candidate({ activity: 'dropping off a prescription' }),
      existing(),
      { localDate: LOCAL_DATE, matcher: matcher(false) },
    );

    expect(decision.kind).toBe('distinct');
  });

  it('keeps two genuine visits on the same day separate', async () => {
    const decision = await decideIdentity(
      candidate({ startsAt: new Date('2026-08-15T17:00:00Z') }), // noon local
      existing({ startsAt: new Date('2026-08-15T23:00:00Z') }), // six local
      { localDate: LOCAL_DATE, matcher: matcher(true) },
    );

    expect(decision.kind).toBe('distinct');
  });

  it('treats an event that adds a time as an update to a timeless one', async () => {
    const decision = await decideIdentity(
      candidate({ timePrecision: 'exact' }),
      existing({ startsAt: null, timePrecision: 'none' }),
      { localDate: LOCAL_DATE, matcher: matcher(true) },
    );

    expect(decision).toEqual({ kind: 'updated', existingId: 'existing-1' });
  });

  it('treats an event that adds nothing as a duplicate of a timed one', async () => {
    const decision = await decideIdentity(
      candidate({ startsAt: null, timePrecision: 'none' }),
      existing({ timePrecision: 'exact' }),
      { localDate: LOCAL_DATE, matcher: matcher(true) },
    );

    expect(decision.kind).toBe('duplicate');
  });

  it('prefers a precise time over an approximate one', async () => {
    const decision = await decideIdentity(
      candidate({ timePrecision: 'exact' }),
      existing({ timePrecision: 'approximate' }),
      { localDate: LOCAL_DATE, matcher: matcher(true) },
    );

    expect(decision.kind).toBe('updated');
  });

  it('matches a cancellation to the plan it cancels, ignoring time', async () => {
    const decision = await decideIdentity(
      candidate({ status: 'cancelled', startsAt: null, timePrecision: 'none' }),
      existing(),
      { localDate: LOCAL_DATE, matcher: matcher(true) },
    );

    expect(decision).toEqual({ kind: 'cancelled', existingId: 'existing-1' });
  });

  it('does not let a cancellation match an unrelated plan', async () => {
    const decision = await decideIdentity(
      candidate({ status: 'cancelled', activity: 'bringing the dog' }),
      existing({ activity: 'coming over with Jenna' }),
      { localDate: LOCAL_DATE, matcher: matcher(false) },
    );

    expect(decision.kind).toBe('distinct');
  });
});

describe('reconciling across messages', () => {
  async function seeded() {
    return createSeededTestDb({ whatsappSenderId: JENNA_WHATSAPP_ID });
  }

  function inbound(messageId: string, body: string) {
    const [message] = parseWhatsAppWebhook(textMessageWebhook({ messageId, body }));
    return message!;
  }

  async function liveEvents(db: Db) {
    const result = await db.query(
      `SELECT subject, activity, starts_at, status, superseded_by, superseded_reason
         FROM group_event ORDER BY created_at`,
    );
    return result.rows;
  }

  it('does not duplicate an event described twice in different words', async () => {
    const { db } = await seeded();

    await ingestInboundMessage(inbound('wamid.ONE', 'Hannah might come with me tomorrow'), {
      db,
      extractor: stubExtractor(
        eventProposal({ subject: 'Hannah', activity: 'coming over with Jenna' }),
      ),
    });
    await ingestInboundMessage(inbound('wamid.TWO', 'Hannah might come over with me tomorrow'), {
      db,
      extractor: stubExtractor(
        eventProposal({ subject: 'Hannah', activity: 'coming along with Jenna' }),
      ),
    });

    const rows = await liveEvents(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!['activity']).toBe('coming over with Jenna');
  });

  it('supersedes rather than deletes when a message adds a time', async () => {
    const { db } = await seeded();

    await ingestInboundMessage(inbound('wamid.ONE', 'Hannah might come over tomorrow'), {
      db,
      extractor: stubExtractor(
        eventProposal({
          subject: 'Hannah',
          activity: 'coming over',
          localTime: null,
          timePrecision: 'none',
        }),
      ),
    });
    await ingestInboundMessage(inbound('wamid.TWO', 'Hannah is coming at four'), {
      db,
      extractor: stubExtractor(
        eventProposal({
          subject: 'Hannah',
          activity: 'coming over',
          localTime: '16:00',
          timePrecision: 'exact',
        }),
      ),
    });

    const rows = await liveEvents(db);
    // Both rows survive: the older one is superseded, not removed, so the
    // message it came from stays traceable.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ superseded_reason: 'updated' });
    expect(rows[0]!['superseded_by']).not.toBeNull();
    expect(rows[1]!['superseded_by']).toBeNull();
  });

  it('keeps two genuinely different visits on the same day', async () => {
    const { db } = await seeded();

    await ingestInboundMessage(inbound('wamid.ONE', 'Hannah at noon'), {
      db,
      extractor: stubExtractor(
        eventProposal({ subject: 'Hannah', activity: 'coming over', localTime: '12:00' }),
      ),
    });
    await ingestInboundMessage(inbound('wamid.TWO', 'Hannah again at six'), {
      db,
      extractor: stubExtractor(
        eventProposal({ subject: 'Hannah', activity: 'coming over', localTime: '18:00' }),
      ),
    });

    const rows = await liveEvents(db);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row['superseded_by'] === null)).toBe(true);
  });

  it('never merges events whose subject Charlie could not resolve', async () => {
    const { db } = await seeded();

    for (const id of ['wamid.ONE', 'wamid.TWO']) {
      await ingestInboundMessage(inbound(id, 'Bobby is coming over tomorrow'), {
        db,
        extractor: stubExtractor(
          eventProposal({ subject: 'Bobby', activity: 'coming over' }),
        ),
      });
    }

    // Two unresolved "Bobby"s might be two different people, so they are left
    // alone rather than merged on a name Charlie does not recognize.
    const rows = await liveEvents(db);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row['superseded_by'] === null)).toBe(true);
  });

  it('cancels a plan when a later message withdraws it', async () => {
    const { db } = await seeded();

    await ingestInboundMessage(inbound('wamid.ONE', 'Hannah is coming over tomorrow at four'), {
      db,
      extractor: stubExtractor(
        eventProposal({ subject: 'Hannah', activity: 'coming over', localTime: '16:00' }),
      ),
    });
    await ingestInboundMessage(inbound('wamid.TWO', "Never mind, Hannah isn't coming"), {
      db,
      extractor: stubExtractor(
        eventProposal({ subject: 'Hannah', activity: 'coming over', status: 'cancelled' }),
      ),
    });

    const rows = await liveEvents(db);
    expect(rows[0]).toMatchObject({ superseded_reason: 'cancelled' });

    // And the agenda no longer mentions it.
    const { describeAgenda, getEventsForLocalDate } = await import(
      '../../src/knowledge/agenda.js'
    );
    const household = await db.query('SELECT id, timezone FROM household LIMIT 1');
    const events = await getEventsForLocalDate(db, {
      householdId: household.rows[0]!['id'] as string,
      timezone: household.rows[0]!['timezone'] as string,
      localDate: '2026-08-14',
    });
    expect(describeAgenda(events, {
      localDate: '2026-08-14',
      todayLocalDate: '2026-08-13',
      timezone: 'America/Chicago',
    })).toContain("don't have anything saved");
  });
});

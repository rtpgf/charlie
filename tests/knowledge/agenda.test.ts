import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import type { Db } from '../../src/db/index.js';
import { instantToLocalDate } from '../../src/knowledge/timezone.js';
import { createServer } from '../../src/server.js';
import { createSeededTestDb } from '../helpers/db.js';
import { intentRequest, TEST_ALEXA_USER_ID } from '../fixtures.js';

const TIMEZONE = 'America/Chicago';

let db: Db;
let householdId: string;

beforeEach(async () => {
  ({ db, householdId } = await createSeededTestDb({ alexaUserId: TEST_ALEXA_USER_ID }));
});

/** Inserts an event directly, so agenda reading is tested on its own. */
async function addEvent(options: {
  subject?: string | null;
  activity: string;
  localDate: string;
  localTime?: string;
  timePrecision?: 'exact' | 'approximate' | 'none';
  status?: 'planned' | 'tentative' | 'cancelled';
}) {
  const { localToInstant } = await import('../../src/knowledge/timezone.js');
  const startsAt = localToInstant(options.localDate, options.localTime ?? '12:00', TIMEZONE);
  await db.query(
    `INSERT INTO group_event
       (household_id, subject, activity, starts_at, date_precision, time_precision, status,
        confidence, source_type, source_id, source_sequence)
     VALUES ($1, $2, $3, $4, 'day', $5, $6, 'explicit', 'group_message',
             (SELECT id FROM group_message LIMIT 1), $7)`,
    [
      householdId,
      options.subject ?? null,
      options.activity,
      startsAt,
      options.timePrecision ?? 'exact',
      options.status ?? 'planned',
      Math.floor(Math.random() * 1_000_000),
    ],
  );
}

/** group_event.source_id is NOT NULL, so agenda tests need one stored message. */
async function ensureSourceMessage() {
  await db.query(
    `INSERT INTO group_message
       (household_id, sender_person_id, channel, external_message_id, sender_external_id, body)
     VALUES ($1, (SELECT id FROM person LIMIT 1), 'whatsapp', 'wamid.AGENDA-SOURCE', '1', 'source')`,
    [householdId],
  );
}

function askAgenda(dateSlot?: string) {
  return request(createServer({ db, extractor: undefined }))
    .post('/alexa')
    .send(intentRequest('AgendaForDateIntent', dateSlot ? { slots: { date: dateSlot } } : {}))
    .set('Content-Type', 'application/json');
}

function spoken(response: { body: { response: { outputSpeech?: { ssml?: string } } } }): string {
  return (response.body.response.outputSpeech?.ssml ?? '')
    .replace(/^<speak>/, '')
    .replace(/<\/speak>$/, '');
}

function localToday(): string {
  return instantToLocalDate(new Date(), TIMEZONE);
}

function localTomorrow(): string {
  return instantToLocalDate(new Date(Date.now() + 24 * 60 * 60 * 1000), TIMEZONE);
}

describe('AgendaForDateIntent', () => {
  it('says it has nothing when the day is empty', async () => {
    const response = await askAgenda(localTomorrow());

    expect(response.status).toBe(200);
    expect(spoken(response)).toBe("I don't have anything saved for tomorrow yet.");
  });

  it('describes a single event with an approximate time', async () => {
    await ensureSourceMessage();
    await addEvent({
      subject: 'Jenna',
      activity: 'coming over',
      localDate: localTomorrow(),
      localTime: '15:00',
      timePrecision: 'approximate',
    });

    const response = await askAgenda(localTomorrow());

    expect(spoken(response)).toBe('Jenna is coming over around 3 PM tomorrow.');
  });

  it('uses "at" for an exact time', async () => {
    await ensureSourceMessage();
    await addEvent({
      activity: 'a doctor appointment',
      localDate: localTomorrow(),
      localTime: '17:00',
    });

    expect(spoken(await askAgenda(localTomorrow()))).toBe(
      'You have a doctor appointment at 5 PM tomorrow.',
    );
  });

  it('describes multiple events in time order', async () => {
    await ensureSourceMessage();
    await addEvent({
      subject: 'Jenna',
      activity: 'coming over',
      localDate: localTomorrow(),
      localTime: '15:00',
      timePrecision: 'approximate',
    });
    await addEvent({
      activity: 'a doctor appointment',
      localDate: localTomorrow(),
      localTime: '17:00',
    });

    expect(spoken(await askAgenda(localTomorrow()))).toBe(
      'Tomorrow, Jenna is coming over around 3 PM, and you have a doctor appointment at 5 PM.',
    );
  });

  it('puts events with no stated time after timed ones', async () => {
    await ensureSourceMessage();
    await addEvent({
      subject: 'Hannah',
      activity: 'coming over with Jenna',
      localDate: localTomorrow(),
      localTime: '00:00',
      timePrecision: 'none',
      status: 'tentative',
    });
    await addEvent({
      subject: 'Jenna',
      activity: 'coming over',
      localDate: localTomorrow(),
      localTime: '15:00',
      timePrecision: 'approximate',
    });

    // The timed event leads even though the untimed one sorts earlier by
    // instant, and each clause is separated so they do not run together.
    expect(spoken(await askAgenda(localTomorrow()))).toBe(
      'Tomorrow, Jenna is coming over around 3 PM, and Hannah might be coming over with Jenna.',
    );
  });

  it('separates three clauses with serial commas', async () => {
    await ensureSourceMessage();
    await addEvent({ activity: 'lunch', localDate: localTomorrow(), localTime: '12:00' });
    await addEvent({
      subject: 'Jenna',
      activity: 'coming over',
      localDate: localTomorrow(),
      localTime: '15:00',
    });
    await addEvent({ activity: 'a dentist appointment', localDate: localTomorrow(), localTime: '17:00' });

    expect(spoken(await askAgenda(localTomorrow()))).toBe(
      'Tomorrow, you have lunch at 12 PM, Jenna is coming over at 3 PM, and you have a dentist appointment at 5 PM.',
    );
  });

  it('answers for today', async () => {
    await ensureSourceMessage();
    await addEvent({ activity: 'lunch', localDate: localToday(), localTime: '12:00' });

    expect(spoken(await askAgenda(localToday()))).toBe('You have lunch at 12 PM today.');
  });

  it('never presents a tentative event as settled', async () => {
    await ensureSourceMessage();
    await addEvent({
      subject: 'Hannah',
      activity: 'stopping by',
      localDate: localTomorrow(),
      localTime: '18:00',
      status: 'tentative',
    });

    expect(spoken(await askAgenda(localTomorrow()))).toBe(
      'Hannah might be stopping by at 6 PM tomorrow.',
    );
  });

  it('omits cancelled events', async () => {
    await ensureSourceMessage();
    await addEvent({
      subject: 'Jenna',
      activity: 'coming over',
      localDate: localTomorrow(),
      status: 'cancelled',
    });

    expect(spoken(await askAgenda(localTomorrow()))).toBe(
      "I don't have anything saved for tomorrow yet.",
    );
  });

  it('does not leak another day’s events', async () => {
    await ensureSourceMessage();
    await addEvent({ activity: 'a morning call', localDate: localToday(), localTime: '09:00' });

    expect(spoken(await askAgenda(localTomorrow()))).toBe(
      "I don't have anything saved for tomorrow yet.",
    );
  });

  it('defaults to today when Alexa sends no date', async () => {
    await ensureSourceMessage();
    await addEvent({ activity: 'lunch', localDate: localToday(), localTime: '12:00' });

    expect(spoken(await askAgenda())).toBe('You have lunch at 12 PM today.');
  });

  it('declines a week-granularity date rather than guessing', async () => {
    const response = await askAgenda('2026-W33');

    expect(response.status).toBe(200);
    expect(spoken(response)).toContain("didn't catch which day");
  });

  it('declines politely for an unmapped Alexa account', async () => {
    const response = await request(createServer({ db, extractor: undefined }))
      .post('/alexa')
      .send(
        intentRequest('AgendaForDateIntent', {
          slots: { date: localTomorrow() },
          userId: 'amzn1.ask.account.not-mapped',
        }),
      )
      .set('Content-Type', 'application/json');

    expect(spoken(response)).toBe("I don't recognize this Alexa account yet.");
  });

  it('speaks gracefully when the database is unavailable', async () => {
    const brokenDb: Db = { query: () => Promise.reject(new Error('connect ECONNREFUSED')) };
    const response = await request(createServer({ db: brokenDb, extractor: undefined }))
      .post('/alexa')
      .send(intentRequest('AgendaForDateIntent', { slots: { date: localTomorrow() } }))
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(spoken(response)).toContain('having trouble remembering');
  });
});

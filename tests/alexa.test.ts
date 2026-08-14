import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import type { Db } from '../src/db/index.js';
import { createServer } from '../src/server.js';
import { createSeededTestDb } from './helpers/db.js';
import {
  intentRequest,
  launchRequest,
  sessionEndedRequest,
  spokenFrom,
  whoIsRequest,
  TEST_ALEXA_USER_ID,
} from './fixtures.js';

const GREETING = "Hi. I'm Charlie. Weekend Charlie is alive.";

let db: Db;

beforeAll(async () => {
  ({ db } = await createSeededTestDb({ alexaUserId: TEST_ALEXA_USER_ID }));
});

function post(body: unknown) {
  return request(createServer({ db }))
    .post('/alexa')
    .send(body)
    .set('Content-Type', 'application/json');
}

/** Speech, with the SSML wrapper removed. */
function spoken(response: { body: { response: { outputSpeech?: { ssml?: string } } } }): string {
  return spokenFrom(response.body.response.outputSpeech?.ssml);
}

// Milestone 1 behaviour, which must keep working.
describe("Charlie's voice", () => {
  it('speaks in a named voice rather than the device default', async () => {
    // Charlie is a he in the family's language, and a skill otherwise inherits
    // whatever voice the Echo happens to be set to.
    const ssml = (await post(launchRequest())).body.response.outputSpeech.ssml;

    expect(ssml).toMatch(/^<speak><voice name="Matthew">/);
    expect(ssml).toMatch(/<\/voice><\/speak>$/);
  });

  it('speaks in that voice everywhere, not only the greeting', async () => {
    const ssml = (await post(whoIsRequest('Natalie'))).body.response.outputSpeech.ssml;

    expect(ssml).toContain('<voice name="Matthew">');
  });
});

describe('POST /alexa', () => {
  it('speaks the greeting on LaunchRequest', async () => {
    const response = await post(launchRequest());

    expect(response.status).toBe(200);
    expect(response.body.version).toBe('1.0');
    expect(response.body.response.outputSpeech).toEqual({
      type: 'SSML',
      ssml: `<speak><voice name="Matthew">${GREETING}</voice></speak>`,
    });
    expect(response.body.response.shouldEndSession).toBe(true);
  });

  it('responds gracefully to an unrecognized intent', async () => {
    const response = await post(intentRequest('SomeIntentWeDoNotHandle'));

    expect(response.status).toBe(200);
    expect(spoken(response)).toContain("can't do that yet");
  });

  it('returns a valid empty envelope for SessionEndedRequest', async () => {
    const response = await post(sessionEndedRequest());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ version: '1.0', response: {} });
  });

  it('rejects a body that is not an Alexa envelope', async () => {
    const response = await post({ hello: 'world' });

    expect(response.status).toBe(400);
  });
});

describe('WhoIsPersonIntent', () => {
  it('answers about a group member from stored data', async () => {
    const response = await post(whoIsRequest('Natalie'));

    expect(response.status).toBe(200);
    expect(spoken(response)).toBe("Natalie is Hannah's daughter and Jenna's niece.");
    expect(response.body.response.shouldEndSession).toBe(true);
  });

  it('answers about a person known by an alias', async () => {
    const response = await post(whoIsRequest('JT'));

    expect(spoken(response)).toBe("JT is James Thomas. He's Hannah's son and Jenna's nephew.");
  });

  it('says it does not know an unknown person', async () => {
    const response = await post(whoIsRequest('Robert'));

    expect(spoken(response)).toBe("I don't think I know anyone named Robert yet.");
  });

  it('asks again when no name was captured', async () => {
    const response = await post(intentRequest('WhoIsPersonIntent'));

    expect(spoken(response)).toContain("didn't catch");
    expect(response.body.response.shouldEndSession).toBe(false);
  });

  it('declines politely for an Alexa account with no household', async () => {
    const response = await post(
      whoIsRequest('Natalie', { userId: 'amzn1.ask.account.not-mapped' }),
    );

    expect(response.status).toBe(200);
    expect(spoken(response)).toBe("I don't recognize this Alexa account yet.");
  });

  it('never leaks ids or internals into speech', async () => {
    const response = await post(
      whoIsRequest('Natalie', { userId: 'amzn1.ask.account.not-mapped' }),
    );

    expect(spoken(response)).not.toContain('amzn1');
    expect(spoken(response)).not.toContain('household');
  });
});

describe('when the database is unreachable', () => {
  const brokenDb: Db = {
    query: () => Promise.reject(new Error('connect ETIMEDOUT 2600:1f16:1e8d:b802::1:5432')),
  };

  function postToBroken(body: unknown) {
    return request(createServer({ db: brokenDb }))
      .post('/alexa')
      .send(body)
      .set('Content-Type', 'application/json');
  }

  it('apologizes in Charlie\'s voice rather than failing the response', async () => {
    const response = await postToBroken(whoIsRequest('Natalie'));

    expect(response.status).toBe(200);
    expect(spoken(response)).toBe(
      "I'm having trouble remembering right now. Please try again in a moment.",
    );
  });

  it('does not leak the underlying error into speech', async () => {
    const response = await postToBroken(whoIsRequest('Natalie'));

    expect(spoken(response)).not.toContain('ETIMEDOUT');
    expect(spoken(response)).not.toContain('2600:');
  });

  it('still answers the launch request, which needs no database', async () => {
    const response = await postToBroken(launchRequest());

    expect(spoken(response)).toBe(GREETING);
  });
});

describe('built-in intents', () => {
  it('offers help without ending the session', async () => {
    const response = await post(intentRequest('AMAZON.HelpIntent'));

    expect(spoken(response)).toContain('who is Natalie');
    expect(response.body.response.shouldEndSession).toBe(false);
  });

  it('ends the session on stop', async () => {
    const response = await post(intentRequest('AMAZON.StopIntent'));

    expect(response.body.response.shouldEndSession).toBe(true);
  });
});

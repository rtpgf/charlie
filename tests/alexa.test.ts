import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createServer } from '../src/server.js';
import { intentRequest, launchRequest, sessionEndedRequest } from './fixtures.js';

const GREETING = "Hi. I'm Charlie. Weekend Charlie is alive.";

function post(body: unknown) {
  return request(createServer()).post('/alexa').send(body).set('Content-Type', 'application/json');
}

describe('POST /alexa', () => {
  it('speaks the greeting on LaunchRequest', async () => {
    const response = await post(launchRequest());

    expect(response.status).toBe(200);
    expect(response.body.version).toBe('1.0');
    expect(response.body.response.outputSpeech).toEqual({
      type: 'SSML',
      ssml: `<speak>${GREETING}</speak>`,
    });
    expect(response.body.response.shouldEndSession).toBe(true);
  });

  it('responds gracefully to an unrecognized intent', async () => {
    const response = await post(intentRequest('SomeIntentWeDoNotHandle'));

    expect(response.status).toBe(200);
    expect(response.body.response.outputSpeech.type).toBe('SSML');
    expect(response.body.response.outputSpeech.ssml).toContain("can't do that yet");
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

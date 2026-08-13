import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { launchRequest } from './fixtures.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Rebuilds the app with fresh env, since config is read once at module load. */
async function serverWithEnv(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  const { createServer } = await import('../src/server.js');
  return createServer();
}

describe('alexa request verification', () => {
  it('rejects an unsigned request when verification is enabled', async () => {
    const app = await serverWithEnv({ ALEXA_VERIFY_REQUESTS: 'true' });

    const response = await request(app).post('/alexa').send(launchRequest());

    expect(response.status).toBe(400);
  });

  it('rejects a request from an unexpected skill id', async () => {
    const app = await serverWithEnv({
      ALEXA_VERIFY_REQUESTS: 'false',
      ALEXA_SKILL_ID: 'amzn1.ask.skill.some-other-skill',
    });

    const response = await request(app).post('/alexa').send(launchRequest());

    expect(response.status).toBe(400);
  });

  it('accepts a request from the configured skill id', async () => {
    const app = await serverWithEnv({
      ALEXA_VERIFY_REQUESTS: 'false',
      ALEXA_SKILL_ID: 'amzn1.ask.skill.test-skill-id',
    });

    const response = await request(app).post('/alexa').send(launchRequest());

    expect(response.status).toBe(200);
  });
});

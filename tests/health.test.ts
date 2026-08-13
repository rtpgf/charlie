import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createServer } from '../src/server.js';

describe('GET /health', () => {
  it('reports healthy', async () => {
    const response = await request(createServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'weekend-charlie' });
  });
});

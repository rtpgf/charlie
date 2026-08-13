import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each database-backed test boots PGlite, which compiles a Postgres WASM
    // build. That first boot is comfortably slower than vitest's 5s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Pinned so the suite is hermetic: dotenv does not override values already
    // present, so these win over whatever is in a developer's .env.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      ALEXA_VERIFY_REQUESTS: 'false',
      ALEXA_SKILL_ID: '',
    },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
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

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
      // Must match tests/helpers/whatsapp.ts.
      WHATSAPP_APP_SECRET: 'test-app-secret',
      WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
      WHATSAPP_ACCESS_TOKEN: '',
      WHATSAPP_PHONE_NUMBER_ID: '',
      DEV_WHATSAPP_SENDER_ID: '',
      // Photo links: pinned empty so a developer's real origin and secret
      // cannot change which URL the APL document is built with.
      PUBLIC_BASE_URL: '',
      MEDIA_LINK_SECRET: '',
      // Presentation is a matter of taste, and a developer is entitled to their
      // own in .env. Pinned so their taste cannot fail the suite: empty means
      // the code's own defaults, and the voice is fixed so it can be asserted.
      ALEXA_VOICE: 'Matthew',
      ALEXA_PHOTO_FIT: '',
      ALEXA_PHOTO_MOTION: '',
      // Normal tests never call a provider: extractors are injected as fakes.
      ANTHROPIC_API_KEY: '',
    },
  },
});

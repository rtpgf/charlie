import 'dotenv/config';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  nodeEnv,
  isTest: nodeEnv === 'test',
  port: int(process.env.PORT, 3000),
  host: process.env.HOST ?? '0.0.0.0',
  logLevel: (process.env.LOG_LEVEL ?? 'info') as LogLevel,
  database: {
    /** Postgres connection string. Supabase, or any Postgres. */
    url: process.env.DATABASE_URL || undefined,
  },
  dev: {
    /**
     * Alexa userId to map to the seeded household when running the seed.
     * Kept in the environment so no real account id lands in source control.
     */
    alexaUserId: process.env.DEV_ALEXA_USER_ID || undefined,
  },
  alexa: {
    /**
     * Signature + timestamp verification of inbound Alexa requests. Required by
     * Amazon for any endpoint the Alexa service can reach.
     */
    verifyRequests: bool(process.env.ALEXA_VERIFY_REQUESTS, true),
    /** Optional: reject requests from any skill other than this one. */
    skillId: process.env.ALEXA_SKILL_ID || undefined,
  },
} as const;

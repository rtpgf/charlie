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
    /** WhatsApp sender (wa_id / phone) mapped to Jenna by the seed. */
    whatsappSenderId: process.env.DEV_WHATSAPP_SENDER_ID || undefined,
  },
  ai: {
    /** Only 'anthropic' is implemented; the seam is KnowledgeExtractor. */
    provider: process.env.AI_PROVIDER || 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY || undefined,
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
    /** Extraction is a small task; low keeps webhook handling prompt. */
    effort: (process.env.AI_EFFORT || 'low') as 'low' | 'medium' | 'high',
  },
  whatsapp: {
    /** Shared with Meta at subscription time; echoes back hub.challenge. */
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || undefined,
    /** App secret, used to validate X-Hub-Signature-256 on every delivery. */
    appSecret: process.env.WHATSAPP_APP_SECRET || undefined,
    /** Bearer token for outbound sends. */
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || undefined,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || undefined,
    /** Meta ships new Graph versions often; pin it in the environment. */
    graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v26.0',
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

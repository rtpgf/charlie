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
  media: {
    /**
     * Charlie's own HTTPS origin, e.g. https://charlie.servehttp.com
     *
     * Photos are served from here rather than straight from object storage:
     * Echo Shows load a short path on the domain they already reach Charlie
     * through, and will not load a 550-character storage URL.
     */
    publicBaseUrl: process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') || undefined,
    /** Signs photo links. Any long random string; rotating it revokes them all. */
    linkSecret: process.env.MEDIA_LINK_SECRET || undefined,
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
    /**
     * Rephrase multi-event Alexa answers. Off by default: it adds a model call
     * to the one surface where someone is waiting for the Echo to speak.
     */
    narrateAgenda: process.env.AI_NARRATE_AGENDA === 'true',
  },
  storage: {
    /**
     * Supabase Storage for group photos. A PRIVATE bucket: media is only ever
     * reachable through short-lived signed URLs.
     */
    url: process.env.SUPABASE_URL || undefined,
    serviceKey: process.env.SUPABASE_SERVICE_KEY || undefined,
    bucket: process.env.SUPABASE_MEDIA_BUCKET || 'group-media',
  },
  messaging: {
    /**
     * How Charlie acknowledges, without taking a turn in the conversation.
     * Channel-neutral: SMS has no reactions, but the meaning is the same.
     */
    reactions: {
      /** Stored successfully. */
      saved: process.env.MESSAGING_REACTION_SAVED || '\u{1F44D}',
      /** Received but not saved -- worth resending later. */
      problem: process.env.MESSAGING_REACTION_PROBLEM || '\u{26A0}\u{FE0F}',
    },
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
    /**
     * The Polly voice Charlie speaks in. Charlie is a he, and a skill otherwise
     * inherits whatever voice the device is set to. Set to '' for the device
     * voice; the value is emitted into SSML, so keep it to a Polly voice name.
     */
    voice: process.env.ALEXA_VOICE ?? 'Matthew',
    /**
     * How a photo meets the screen: 'contain' shows the whole photograph,
     * 'cover' fills the screen and crops what does not fit. A setting for now;
     * the code path it feeds is per-request, so this can become a per-person
     * preference without moving anything.
     */
    photoFit: (process.env.ALEXA_PHOTO_FIT === 'cover' ? 'cover' : 'contain') as
      | 'contain'
      | 'cover',
  },
} as const;

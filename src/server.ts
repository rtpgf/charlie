import express, { type Express } from 'express';

import { describeRequest, handleAlexaRequest } from './alexa/handler.js';
import type { PhotoFit } from './alexa/apl.js';
import type { MediaLinkConfig } from './alexa/photos.js';
import { speak } from './alexa/responses.js';
import { verifyAlexaRequest, verifySkillId } from './alexa/verify.js';
import { config } from './config.js';
import { getPool, type Db } from './db/index.js';
import { logger } from './logger.js';
import type { Messenger } from './messaging/types.js';
import { createWhatsAppMessenger } from './messaging/whatsapp/client.js';
import { createWhatsAppWebhookRouter } from './messaging/whatsapp/webhook.js';
import {
  createAnthropicActivityMatcher,
  createAnthropicAgendaNarrator,
  createAnthropicExtractor,
  createAnthropicMediaAnalyzer,
} from './knowledge/providers/anthropic.js';
import { createWhatsAppMediaFetcher, type MediaFetcher } from './media/retrieve.js';
import { createMediaRouter } from './media/router.js';
import { createSharpResizer, type ImageResizer } from './media/resize.js';
import { createSupabaseMediaStore, type MediaStore } from './media/store.js';
import type { MediaAnalyzer } from './media/types.js';
import type {
  ActivityMatcher,
  AgendaNarrator,
  KnowledgeExtractor,
} from './knowledge/types.js';
import { havingTrouble } from './services/speech.js';

export interface ServerDeps {
  /** Defaults to the shared pool, which is created on first use so that
   *  database-free paths keep working without DATABASE_URL. */
  db?: Db;
  /** Defaults to the WhatsApp client when Meta credentials are configured. */
  messenger?: Messenger | undefined;
  /** Defaults to the configured AI provider. Absent means no extraction. */
  extractor?: KnowledgeExtractor | undefined;
  /** Defaults to the configured AI provider. Absent falls back to word overlap. */
  matcher?: ActivityMatcher | undefined;
  /** Absent means Alexa always speaks the deterministic sentence. */
  narrator?: AgendaNarrator | undefined;
  /** Private object storage for group photos. */
  store?: MediaStore | undefined;
  /** Retrieves inbound media from Meta. */
  fetcher?: MediaFetcher | undefined;
  /** Vision analysis for stored photos. */
  analyzer?: MediaAnalyzer | undefined;
  /** Serves photos from Charlie's own domain. Absent falls back to storage. */
  link?: MediaLinkConfig | undefined;
  /** Makes screen-sized copies of photos. Absent means originals are served. */
  resizer?: ImageResizer | undefined;
  /** Whole photograph, or filled screen with cropping. */
  photoFit?: PhotoFit | undefined;
  /** The slow drift across a still photograph. */
  photoMotion?: boolean | undefined;
  /** Hold the microphone open after a photo, for bare "next" follow-ups. */
  listenAfterPhotos?: boolean | undefined;
}

/** Only built when Meta credentials are present; WhatsApp stays optional. */
function defaultMessenger(): Messenger | undefined {
  const { accessToken, phoneNumberId, graphApiVersion } = config.whatsapp;
  if (!accessToken || !phoneNumberId) return undefined;
  return createWhatsAppMessenger({ accessToken, phoneNumberId, graphApiVersion });
}

/**
 * Built only when an API key is present. Charlie's Alexa features and WhatsApp
 * transport work without it; knowledge extraction is the only thing that stops.
 */
function defaultExtractor(): KnowledgeExtractor | undefined {
  const { provider, apiKey, model, effort } = config.ai;
  if (!apiKey) return undefined;
  if (provider !== 'anthropic') {
    logger.warn('unknown AI_PROVIDER, knowledge extraction disabled', { provider });
    return undefined;
  }
  return createAnthropicExtractor({ apiKey, model, effort });
}

/** Only built when Supabase Storage is configured; photos are optional. */
function defaultStore(): MediaStore | undefined {
  const { url, serviceKey, bucket } = config.storage;
  if (!url || !serviceKey) return undefined;
  return createSupabaseMediaStore({ url, serviceKey, bucket });
}

function defaultFetcher(): MediaFetcher | undefined {
  const { accessToken, phoneNumberId, graphApiVersion } = config.whatsapp;
  if (!accessToken || !phoneNumberId) return undefined;
  return createWhatsAppMediaFetcher({ accessToken, phoneNumberId, graphApiVersion });
}

function defaultAnalyzer(): MediaAnalyzer | undefined {
  const { provider, apiKey, model, effort } = config.ai;
  if (!apiKey || provider !== 'anthropic') return undefined;
  return createAnthropicMediaAnalyzer({ apiKey, model, effort });
}

function defaultNarrator(): AgendaNarrator | undefined {
  const { provider, apiKey, model, effort } = config.ai;
  if (!apiKey || provider !== 'anthropic' || !config.ai.narrateAgenda) return undefined;
  return createAnthropicAgendaNarrator({ apiKey, model, effort });
}

function defaultMatcher(): ActivityMatcher | undefined {
  const { provider, apiKey, model, effort } = config.ai;
  if (!apiKey || provider !== 'anthropic') return undefined;
  return createAnthropicActivityMatcher({ apiKey, model, effort });
}

/**
 * Photos are served from Charlie's own domain only when both the origin and a
 * signing secret are set. Without them, Alexa falls back to storage's own
 * signed URL -- which works everywhere except an Echo Show.
 */
function defaultLink(): MediaLinkConfig | undefined {
  const { publicBaseUrl, linkSecret } = config.media;
  if (!publicBaseUrl || !linkSecret) return undefined;
  return { baseUrl: publicBaseUrl, secret: linkSecret };
}

export function createServer(deps: ServerDeps = {}): Express {
  const app = express();
  const db: Db = deps.db ?? { query: (text, params) => getPool().query(text, params) };
  const messenger = deps.messenger ?? defaultMessenger();
  const extractor = 'extractor' in deps ? deps.extractor : defaultExtractor();
  const matcher = 'matcher' in deps ? deps.matcher : defaultMatcher();
  const narrator = 'narrator' in deps ? deps.narrator : defaultNarrator();
  const store = 'store' in deps ? deps.store : defaultStore();
  const fetcher = 'fetcher' in deps ? deps.fetcher : defaultFetcher();
  const analyzer = 'analyzer' in deps ? deps.analyzer : defaultAnalyzer();
  const link = 'link' in deps ? deps.link : defaultLink();
  const resizer = 'resizer' in deps ? deps.resizer : createSharpResizer();
  const photoFit = deps.photoFit ?? config.alexa.photoFit;
  const photoMotion = deps.photoMotion ?? config.alexa.photoMotion;
  const listenAfterPhotos = deps.listenAfterPhotos ?? config.alexa.listenAfterPhotos;

  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'weekend-charlie' });
  });

  app.use('/media', createMediaRouter({ db, store, secret: config.media.linkSecret }));

  app.use('/webhooks/whatsapp', createWhatsAppWebhookRouter({
      db,
      messenger,
      extractor,
      matcher,
      media: { fetcher, store, analyzer, resizer },
    }));

  app.post(
    '/alexa',
    express.json({
      limit: '256kb',
      // Alexa sends application/json; be tolerant of a missing/odd content type
      // so a bad header surfaces as a verification failure, not a silent 415.
      type: () => true,
      verify: (req, _res, buf) => {
        // `verify` types req as IncomingMessage; at runtime it is the Express Request.
        (req as express.Request).rawBody = buf.toString('utf8');
      },
    }),
    verifyAlexaRequest,
    verifySkillId,
    async (req, res) => {
      const envelope = req.body;

      if (!envelope?.request?.type) {
        logger.warn('malformed alexa envelope');
        res.status(400).json({ error: 'not an Alexa request envelope' });
        return;
      }

      logger.info('alexa request', describeRequest(envelope));

      try {
        const response = await handleAlexaRequest(envelope, { db, narrator, store, link, photoFit, photoMotion, listenAfterPhotos });
        res.json(response);
      } catch (error: unknown) {
        // Answer in Charlie's voice instead of letting Alexa fall back to its
        // generic failure line. Still logged at error level -- the 200 is for
        // the listener's benefit, not a claim that nothing went wrong.
        logger.error('alexa handler failed', {
          requestId: envelope.request.requestId,
          reason: error instanceof Error ? error.message : 'unknown',
        });
        res.json(speak(havingTrouble()));
      }
    },
  );

  return app;
}

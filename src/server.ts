import express, { type Express } from 'express';

import { describeRequest, handleAlexaRequest } from './alexa/handler.js';
import { speak } from './alexa/responses.js';
import { verifyAlexaRequest, verifySkillId } from './alexa/verify.js';
import { config } from './config.js';
import { getPool, type Db } from './db/index.js';
import { logger } from './logger.js';
import type { Messenger } from './messaging/types.js';
import { createWhatsAppMessenger } from './messaging/whatsapp/client.js';
import { createWhatsAppWebhookRouter } from './messaging/whatsapp/webhook.js';
import { createAnthropicExtractor } from './knowledge/providers/anthropic.js';
import type { KnowledgeExtractor } from './knowledge/types.js';
import { havingTrouble } from './services/speech.js';

export interface ServerDeps {
  /** Defaults to the shared pool, which is created on first use so that
   *  database-free paths keep working without DATABASE_URL. */
  db?: Db;
  /** Defaults to the WhatsApp client when Meta credentials are configured. */
  messenger?: Messenger | undefined;
  /** Defaults to the configured AI provider. Absent means no extraction. */
  extractor?: KnowledgeExtractor | undefined;
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

export function createServer(deps: ServerDeps = {}): Express {
  const app = express();
  const db: Db = deps.db ?? { query: (text, params) => getPool().query(text, params) };
  const messenger = deps.messenger ?? defaultMessenger();
  const extractor = 'extractor' in deps ? deps.extractor : defaultExtractor();

  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'weekend-charlie' });
  });

  app.use('/webhooks/whatsapp', createWhatsAppWebhookRouter({ db, messenger, extractor }));

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
        const response = await handleAlexaRequest(envelope, { db });
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

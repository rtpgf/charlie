import { json, Router, type RequestHandler } from 'express';

import { config } from '../../config.js';
import type { Db } from '../../db/index.js';
import { logger } from '../../logger.js';
import { ingestInboundMessage } from '../service.js';
import type { KnowledgeExtractor } from '../../knowledge/types.js';
import type { Messenger } from '../types.js';
import { parseWhatsAppWebhook } from './parse.js';
import { verifySignature, verifySubscription } from './verify.js';

/**
 * Meta's webhook endpoints.
 *
 * GET  is the one-time subscription challenge.
 * POST is event delivery, authenticated by X-Hub-Signature-256.
 *
 * Both are inert unless WhatsApp is configured, so Charlie's Alexa
 * functionality works with no Meta credentials present.
 */

export interface WhatsAppWebhookDeps {
  db: Db;
  messenger?: Messenger | undefined;
  extractor?: KnowledgeExtractor | undefined;
}

export function createWhatsAppWebhookRouter(deps: WhatsAppWebhookDeps): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const verifyToken = config.whatsapp.verifyToken;
    if (!verifyToken) {
      logger.warn('whatsapp webhook verification attempted but WHATSAPP_VERIFY_TOKEN is unset');
      res.sendStatus(503);
      return;
    }

    const challenge = verifySubscription(req.query as Record<string, unknown>, verifyToken);
    if (challenge === null) {
      logger.warn('whatsapp webhook verification rejected');
      res.sendStatus(403);
      return;
    }

    logger.info('whatsapp webhook verified');
    // Meta expects the raw challenge value, not JSON.
    res.type('text/plain').send(challenge);
  });

  router.post('/', captureRawBody, async (req, res) => {
    const appSecret = config.whatsapp.appSecret;
    if (!appSecret) {
      logger.warn('whatsapp webhook received but WHATSAPP_APP_SECRET is unset');
      res.sendStatus(503);
      return;
    }

    const rawBody = req.rawBody;
    const signature = req.get('x-hub-signature-256');

    if (rawBody === undefined || !verifySignature(rawBody, signature, appSecret)) {
      logger.warn('whatsapp webhook signature rejected', {
        signaturePresent: Boolean(signature),
      });
      res.sendStatus(403);
      return;
    }

    const messages = parseWhatsAppWebhook(req.body);

    logger.info('whatsapp webhook received', {
      channel: 'whatsapp',
      messageCount: messages.length,
    });

    // Meta expects prompt acknowledgement. The work here is a couple of small
    // queries and at most one outbound call, so it stays synchronous -- no
    // queue is warranted at this size.
    try {
      for (const message of messages) {
        await ingestInboundMessage(message, deps);
      }
    } catch (error: unknown) {
      // Already-handled failures return outcomes rather than throwing; this is
      // the unexpected case. Still 200: Meta retrying would not help, and the
      // message-level idempotency key protects us if it does.
      logger.error('whatsapp webhook processing failed', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }

    res.sendStatus(200);
  });

  return router;
}

/**
 * The signature covers the exact bytes Meta sent, so the raw body must be kept
 * before JSON parsing. Same approach as the Alexa endpoint.
 */
const captureRawBody: RequestHandler = json({
  limit: '256kb',
  type: () => true,
  verify: (req, _res, buffer) => {
    (req as Parameters<RequestHandler>[0]).rawBody = buffer.toString('utf8');
  },
});

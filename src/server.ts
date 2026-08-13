import express, { type Express } from 'express';

import { describeRequest, handleAlexaRequest } from './alexa/handler.js';
import { speak } from './alexa/responses.js';
import { verifyAlexaRequest, verifySkillId } from './alexa/verify.js';
import { getPool, type Db } from './db/index.js';
import { logger } from './logger.js';
import { havingTrouble } from './services/speech.js';

export interface ServerDeps {
  /** Defaults to the shared pool, which is created on first use so that
   *  database-free paths keep working without DATABASE_URL. */
  db?: Db;
}

export function createServer(deps: ServerDeps = {}): Express {
  const app = express();
  const db: Db = deps.db ?? { query: (text, params) => getPool().query(text, params) };

  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'weekend-charlie' });
  });

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

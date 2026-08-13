import express, { type Express } from 'express';

import { describeRequest, handleAlexaRequest } from './alexa/handler.js';
import { verifyAlexaRequest, verifySkillId } from './alexa/verify.js';
import { logger } from './logger.js';

export function createServer(): Express {
  const app = express();

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
    (req, res) => {
      const envelope = req.body;

      if (!envelope?.request?.type) {
        logger.warn('malformed alexa envelope');
        res.status(400).json({ error: 'not an Alexa request envelope' });
        return;
      }

      logger.info('alexa request', describeRequest(envelope));

      try {
        const response = handleAlexaRequest(envelope);
        res.json(response);
      } catch (error: unknown) {
        logger.error('alexa handler failed', {
          requestId: envelope.request.requestId,
          reason: error instanceof Error ? error.message : 'unknown',
        });
        res.status(500).json({ error: 'internal error' });
      }
    },
  );

  return app;
}

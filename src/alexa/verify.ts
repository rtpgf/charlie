import type { RequestHandler } from 'express';

import {
  SkillRequestSignatureVerifier,
  TimestampVerifier,
  type Verifier,
} from 'ask-sdk-express-adapter';

import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Amazon requires that a self-hosted skill endpoint verify every request:
 * the request signature (Signature-256 / SignatureCertChainUrl headers) and the
 * request timestamp (within 150 seconds). We use Amazon's own verifier
 * implementations from ask-sdk-express-adapter rather than hand-rolling crypto.
 *
 * See: developer.amazon.com/docs/alexa/custom-skills/host-a-custom-skill-as-a-web-service.html
 */
const verifiers: Verifier[] = [new SkillRequestSignatureVerifier(), new TimestampVerifier()];

/**
 * Raw request body, captured by `express.json({ verify })`. Signature
 * verification hashes the exact bytes Amazon sent, so a re-serialized object
 * will not do.
 */
declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: string;
  }
}

export const verifyAlexaRequest: RequestHandler = (req, res, next) => {
  if (!config.alexa.verifyRequests) {
    logger.warn('alexa request verification disabled', { requestId: req.body?.request?.requestId });
    next();
    return;
  }

  const rawBody = req.rawBody;
  if (rawBody === undefined) {
    res.status(400).json({ error: 'missing request body' });
    return;
  }

  Promise.all(verifiers.map((verifier) => verifier.verify(rawBody, req.headers)))
    .then(() => next())
    .catch((error: unknown) => {
      // Amazon's documented behaviour for a request that fails verification.
      logger.warn('alexa request verification failed', {
        reason: error instanceof Error ? error.message : 'unknown',
        // Header names only, never values: enough to tell a missing signature
        // header apart from a genuine crypto failure.
        headerNames: Object.keys(req.headers).sort(),
      });
      res.status(400).json({ error: 'invalid request signature or timestamp' });
    });
};

/** Optional defence-in-depth: only serve the skill we were configured for. */
export const verifySkillId: RequestHandler = (req, res, next) => {
  const expected = config.alexa.skillId;
  if (!expected) {
    next();
    return;
  }

  const actual = req.body?.context?.System?.application?.applicationId
    ?? req.body?.session?.application?.applicationId;

  if (actual !== expected) {
    logger.warn('rejected request for unexpected skill id');
    res.status(400).json({ error: 'unexpected applicationId' });
    return;
  }

  next();
};

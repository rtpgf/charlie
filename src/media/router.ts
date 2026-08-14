import { Router } from 'express';

import type { Db } from '../db/index.js';
import { logger } from '../logger.js';
import { verifyMediaToken } from './link.js';
import { findMediaById } from './repository.js';
import type { MediaStore } from './store.js';

/**
 * Serves a group photo to a device, from Charlie's own domain.
 *
 * The only route that returns family content to something other than Alexa or
 * WhatsApp, so it is deliberately narrow: one signed, expiring token in, one
 * image out, nothing else. No listing, no ranging, no parameters.
 */

export interface MediaRouterDeps {
  db: Db;
  store?: MediaStore | undefined;
  secret?: string | undefined;
}

/** Matches the token lifetime; the URL stops working long before this matters. */
const CACHE_SECONDS = 15 * 60;

export function createMediaRouter(deps: MediaRouterDeps): Router {
  const router = Router();

  router.get('/:token', async (req, res) => {
    const { secret, store } = deps;
    if (!secret || !store) {
      // Nothing is being served, so this is a configuration problem, not a
      // request problem -- but the caller still learns nothing either way.
      logger.error('photo requested but media links are not configured');
      res.status(404).end();
      return;
    }

    const mediaId = verifyMediaToken({
      token: String(req.params['token']),
      secret,
      now: new Date(),
    });
    if (!mediaId) {
      // Bad signature, tampering and expiry are one outcome on purpose.
      res.status(404).end();
      return;
    }

    try {
      const media = await findMediaById(deps.db, mediaId);
      if (!media?.storageKey || media.status !== 'stored') {
        res.status(404).end();
        return;
      }

      const object = await store.get(media.storageKey);
      res.setHeader('Content-Type', media.mimeType ?? object.contentType);
      res.setHeader('Content-Length', String(object.bytes.byteLength));
      // Private: the token is the credential, so no shared cache may keep it.
      res.setHeader('Cache-Control', `private, max-age=${CACHE_SECONDS}`);
      // The photo is displayed, never offered as a download.
      res.setHeader('Content-Disposition', 'inline');
      res.status(200).end(Buffer.from(object.bytes));
    } catch (error: unknown) {
      logger.error('serving a photo failed', {
        mediaId,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      res.status(404).end();
    }
  });

  return router;
}

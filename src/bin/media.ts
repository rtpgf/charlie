/**
 * Retry retrieval for one stored media item:
 *
 *   npm run media:reprocess -- <media-id>
 *
 * A plain command, not a job system. Meta keeps inbound media ids for about
 * seven days, which is the real window for recovering a failed download.
 */
import { config } from '../config.js';
import { closePool, getPool } from '../db/index.js';
import { createAnthropicMediaAnalyzer } from '../knowledge/providers/anthropic.js';
import { reprocessMedia } from '../media/service.js';
import { createSharpResizer } from '../media/resize.js';
import { createWhatsAppMediaFetcher } from '../media/retrieve.js';
import { createSupabaseMediaStore } from '../media/store.js';
import { logger } from '../logger.js';

const mediaId = process.argv[2];

async function main(): Promise<void> {
  if (!mediaId) {
    console.error('usage: npm run media:reprocess -- <media-id>');
    process.exitCode = 1;
    return;
  }

  const { accessToken, phoneNumberId, graphApiVersion } = config.whatsapp;
  const { url, serviceKey, bucket } = config.storage;
  if (!accessToken || !phoneNumberId || !url || !serviceKey) {
    logger.error('media reprocessing needs WhatsApp and Supabase Storage configuration');
    process.exitCode = 1;
    return;
  }

  const outcome = await reprocessMedia(getPool(), mediaId, {
    db: getPool(),
    fetcher: createWhatsAppMediaFetcher({ accessToken, phoneNumberId, graphApiVersion }),
    store: createSupabaseMediaStore({ url, serviceKey, bucket }),
    resizer: createSharpResizer(),
    analyzer: config.ai.apiKey
      ? createAnthropicMediaAnalyzer({
          apiKey: config.ai.apiKey,
          model: config.ai.model,
          effort: config.ai.effort,
        })
      : undefined,
  });

  logger.info('media reprocess complete', { mediaId, outcome });
  if (outcome === 'failed' || outcome === 'unknown_media') process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    logger.error('media reprocess failed', {
      mediaId,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    process.exitCode = 1;
  })
  .finally(closePool);

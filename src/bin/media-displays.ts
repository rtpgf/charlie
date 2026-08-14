/**
 * Make the screen-sized copy for photos stored before resizing existed:
 *
 *   npm run media:displays
 *
 * Reads the originals out of Charlie's own storage rather than from Meta,
 * which keeps inbound media ids for only about a week. Safe to re-run: a photo
 * that already has a display copy, or never needed one, is skipped.
 */
import { config } from '../config.js';
import { closePool, getPool } from '../db/index.js';
import { setMediaDisplaySize } from '../media/repository.js';
import { createSharpResizer, displayStorageKey, storeDisplayCopy } from '../media/resize.js';
import { createSupabaseMediaStore } from '../media/store.js';
import { logger } from '../logger.js';

async function main(): Promise<void> {
  const { url, serviceKey, bucket } = config.storage;
  if (!url || !serviceKey) {
    logger.error('display copies need Supabase Storage configuration');
    process.exitCode = 1;
    return;
  }

  const db = getPool();
  const store = createSupabaseMediaStore({ url, serviceKey, bucket });
  const resizer = createSharpResizer();

  const stored = await db.query(
    `SELECT id, storage_key, display_width FROM group_media
      WHERE status = 'stored' AND storage_key IS NOT NULL
      ORDER BY shared_at ASC`,
  );

  let made = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of stored.rows) {
    const mediaId = row['id'] as string;
    const storageKey = row['storage_key'] as string;

    // A photo with both a display copy and a recorded shape needs nothing. The
    // shape is checked too, so photos from before it was recorded are measured
    // rather than skipped for having a copy already.
    if (row['display_width']) {
      try {
        await store.get(displayStorageKey(storageKey));
        skipped += 1;
        continue;
      } catch {
        // No display copy despite a recorded shape: fall through and make one.
      }
    }

    try {
      const original = await store.get(storageKey);
      const display = await storeDisplayCopy({ storageKey, bytes: original.bytes, store, resizer });
      if (!display) {
        failed += 1;
        logger.error('could not read the photo', { mediaId });
        continue;
      }
      await setMediaDisplaySize(db, { mediaId, width: display.width, height: display.height });
      made += 1;
      logger.info('display copy ready', {
        mediaId,
        resized: display.stored,
        shape: `${display.width}x${display.height}`,
      });
    } catch (error: unknown) {
      failed += 1;
      logger.error('display copy failed', {
        mediaId,
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  logger.info('display copies complete', { made, skipped, failed });
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    logger.error('display copies failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    process.exitCode = 1;
  })
  .finally(closePool);

/**
 * Print a signed URL for a stored photo, so a human can open it in a browser:
 *
 *   npm run media:signed-url                 # every photo in the latest share
 *   npm run media:signed-url -- <media-id>   # one specific photo
 *
 * A diagnostic, not a feature. When an Echo Show renders the photo frame but no
 * photo, this is what separates "the URL is broken" from "the APL document is
 * broken" -- if the link opens in a browser, storage and signing are fine and
 * the problem is on the device side.
 *
 * These URLs are printed to stdout on purpose, which is the one place Charlie
 * does that. They are live links to a family's private photos, so they are
 * deliberately short-lived and never written to the log.
 */
import { config } from '../config.js';
import { closePool, getPool, type Db } from '../db/index.js';
import { getLatestBatch } from '../media/gallery.js';
import { findMediaById } from '../media/repository.js';
import { createSupabaseMediaStore } from '../media/store.js';
import { logger } from '../logger.js';

/** Long enough to paste into a browser, short enough to be useless later. */
const EXPIRES_IN_SECONDS = 10 * 60;

interface Target {
  mediaId: string;
  storageKey: string;
  label: string;
}

async function targets(db: Db, mediaId: string | undefined): Promise<Target[]> {
  if (mediaId) {
    const media = await findMediaById(db, mediaId);
    if (!media) throw new Error(`no media with id ${mediaId}`);
    if (!media.storageKey) throw new Error(`media ${mediaId} is ${media.status}, not stored`);
    return [{ mediaId: media.id, storageKey: media.storageKey, label: media.status }];
  }

  // No id given: whichever group most recently shared something.
  const recent = await db.query(
    `SELECT household_id FROM group_media WHERE status = 'stored'
      ORDER BY shared_at DESC LIMIT 1`,
  );
  const householdId = recent.rows[0]?.['household_id'] as string | undefined;
  if (!householdId) throw new Error('no stored photos yet');

  const batch = await getLatestBatch(db, householdId);
  if (!batch || batch.items.length === 0) throw new Error('no stored photos yet');

  console.log(`latest share: ${batch.senderName}, ${batch.items.length} photo(s)`);
  if (batch.caption) console.log(`caption     : ${batch.caption}`);
  console.log('');

  return batch.items.map((item) => ({
    mediaId: item.mediaId,
    storageKey: item.storageKey,
    label: `${item.sequence + 1} of ${batch.items.length}`,
  }));
}

async function main(): Promise<void> {
  const { url, serviceKey, bucket } = config.storage;
  if (!url || !serviceKey) {
    logger.error('signed URLs need Supabase Storage configuration');
    process.exitCode = 1;
    return;
  }

  const db = getPool();
  const store = createSupabaseMediaStore({ url, serviceKey, bucket });
  const items = await targets(db, process.argv[2]);

  for (const item of items) {
    const signed = await store.getSignedUrl(item.storageKey, EXPIRES_IN_SECONDS);
    console.log(`${item.label}  (${item.mediaId})`);
    console.log(signed);
    console.log('');
  }

  console.log(`These links expire in ${EXPIRES_IN_SECONDS / 60} minutes.`);
}

main()
  .catch((error: unknown) => {
    logger.error('could not produce a signed URL', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    process.exitCode = 1;
  })
  .finally(closePool);

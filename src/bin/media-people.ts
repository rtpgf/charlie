/**
 * Re-derive who is in each photo from the words that arrived with it:
 *
 *   npm run media:people
 *
 * Evidence is recorded once, when a photo is ingested, so a change to the rules
 * that decide what a caption means does not reach photos already stored. This
 * re-runs those rules over stored captions.
 *
 * It only ever *adds* evidence. Nothing is deleted and nothing is overwritten:
 * an earlier, weaker claim about the same photo and person stays exactly where
 * it is, outranked rather than erased, which is how the rest of Charlie treats
 * things it used to believe.
 */
import { config } from '../config.js';
import { closePool, getPool } from '../db/index.js';
import { loadGroupGraph } from '../group/repository.js';
import { captionEvidenceForImage } from '../media/evidence.js';
import { insertEvidence } from '../media/repository.js';
import { logger } from '../logger.js';

async function main(): Promise<void> {
  if (!config.database.url) {
    logger.error('media:people needs DATABASE_URL');
    process.exitCode = 1;
    return;
  }

  const db = getPool();
  const rows = await db.query(
    `SELECT m.id, m.household_id, m.caption, m.group_message_id,
            COALESCE(a.people_visible, 1) AS people_visible
       FROM group_media m
       LEFT JOIN media_analysis a
         ON a.group_media_id = m.id AND a.status = 'accepted'
      WHERE m.status = 'stored' AND m.caption IS NOT NULL
      ORDER BY m.shared_at ASC`,
  );

  const graphs = new Map<string, Awaited<ReturnType<typeof loadGroupGraph>>>();
  let added = 0;

  for (const row of rows.rows) {
    const householdId = row['household_id'] as string;
    if (!graphs.has(householdId)) {
      graphs.set(householdId, await loadGroupGraph(db, householdId));
    }

    const evidence = captionEvidenceForImage(
      graphs.get(householdId)!,
      row['caption'] as string,
      Number(row['people_visible']),
    );

    for (const claim of evidence) {
      await insertEvidence(db, {
        mediaId: row['id'] as string,
        personId: claim.person.id,
        evidenceType: claim.evidenceType,
        confidence: claim.confidence,
        status: claim.status,
        sourceMessageId: row['group_message_id'] as string,
      });
      added += 1;
      logger.info('caption evidence', {
        mediaId: row['id'],
        person: claim.person.preferredName,
        evidenceType: claim.evidenceType,
      });
    }
  }

  logger.info('caption evidence rebuilt', { photos: rows.rows.length, claims: added });
}

main()
  .catch((error: unknown) => {
    logger.error('rebuilding caption evidence failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    process.exitCode = 1;
  })
  .finally(closePool);

import type { Db } from '../db/index.js';

/**
 * Reading group media back out.
 *
 * The one place anything asks "what photos does this group have?". Alexa never
 * touches WhatsApp or object storage; it asks here. Built to outlast M5 —
 * Memories, a digest, or a yearbook would read through the same service.
 */

export interface GalleryItem {
  mediaId: string;
  storageKey: string;
  sequence: number;
  description: string | null;
  sharedAt: Date;
  capturedAt: Date | null;
}

export interface GalleryBatch {
  batchId: string;
  householdId: string;
  senderName: string;
  caption: string | null;
  summary: string | null;
  sharedAt: Date;
  items: GalleryItem[];
}

function toItem(row: Record<string, unknown>): GalleryItem {
  return {
    mediaId: row['id'] as string,
    storageKey: row['storage_key'] as string,
    sequence: row['sequence'] as number,
    description: (row['description'] as string | null) ?? null,
    sharedAt: row['shared_at'] as Date,
    capturedAt: (row['captured_at'] as Date | null) ?? null,
  };
}

/**
 * The most recent share, as one coherent set.
 *
 * Ordered by when the family *shared* it, never by uncertain capture dates, and
 * items keep the order they were sent in rather than storage or analysis order.
 */
export async function getLatestBatch(
  db: Db,
  householdId: string,
): Promise<GalleryBatch | null> {
  const batch = await db.query(
    `SELECT b.id, b.household_id, b.caption, b.summary, b.shared_at, p.preferred_name
       FROM media_batch b
       JOIN person p ON p.id = b.sender_person_id
      WHERE b.household_id = $1
        AND EXISTS (
          SELECT 1 FROM group_media m
           WHERE m.media_batch_id = b.id AND m.status = 'stored'
        )
      ORDER BY b.shared_at DESC
      LIMIT 1`,
    [householdId],
  );

  const row = batch.rows[0];
  if (!row) return null;

  const items = await db.query(
    `SELECT m.id, m.storage_key, m.sequence, m.shared_at, m.captured_at, a.description
       FROM group_media m
       LEFT JOIN media_analysis a
         ON a.group_media_id = m.id AND a.status = 'accepted'
      WHERE m.media_batch_id = $1 AND m.status = 'stored'
      ORDER BY m.sequence ASC`,
    [row['id']],
  );

  return {
    batchId: row['id'] as string,
    householdId: row['household_id'] as string,
    senderName: row['preferred_name'] as string,
    caption: (row['caption'] as string | null) ?? null,
    summary: (row['summary'] as string | null) ?? null,
    sharedAt: row['shared_at'] as Date,
    items: items.rows.map(toItem),
  };
}

export async function getBatch(db: Db, batchId: string): Promise<GalleryBatch | null> {
  const batch = await db.query(
    `SELECT b.id, b.household_id, b.caption, b.summary, b.shared_at, p.preferred_name
       FROM media_batch b JOIN person p ON p.id = b.sender_person_id
      WHERE b.id = $1`,
    [batchId],
  );
  const row = batch.rows[0];
  if (!row) return null;

  const items = await db.query(
    `SELECT m.id, m.storage_key, m.sequence, m.shared_at, m.captured_at, a.description
       FROM group_media m
       LEFT JOIN media_analysis a
         ON a.group_media_id = m.id AND a.status = 'accepted'
      WHERE m.media_batch_id = $1 AND m.status = 'stored'
      ORDER BY m.sequence ASC`,
    [batchId],
  );

  return {
    batchId: row['id'] as string,
    householdId: row['household_id'] as string,
    senderName: row['preferred_name'] as string,
    caption: (row['caption'] as string | null) ?? null,
    summary: (row['summary'] as string | null) ?? null,
    sharedAt: row['shared_at'] as Date,
    items: items.rows.map(toItem),
  };
}

/**
 * Recent photos of one person.
 *
 * Accepted evidence only, and never `weak_context` — a caption naming someone
 * over a crowd says who the occasion involved, not whose face is whose.
 */
export async function getRecentMediaByPerson(
  db: Db,
  input: { householdId: string; personId: string; limit?: number },
): Promise<GalleryItem[]> {
  const result = await db.query(
    `SELECT DISTINCT m.id, m.storage_key, m.sequence, m.shared_at, m.captured_at,
            a.description
       FROM group_media m
       JOIN media_person_evidence e ON e.group_media_id = m.id
       LEFT JOIN media_analysis a
         ON a.group_media_id = m.id AND a.status = 'accepted'
      WHERE m.household_id = $1
        AND e.person_id = $2
        AND e.status = 'accepted'
        AND e.evidence_type <> 'weak_context'
        AND e.superseded_by IS NULL
        AND m.status = 'stored'
      ORDER BY m.shared_at DESC, m.sequence ASC
      LIMIT $3`,
    [input.householdId, input.personId, input.limit ?? 20],
  );

  return result.rows.map(toItem);
}

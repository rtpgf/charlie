import type { Db } from '../db/index.js';
import { belongsToBatch, type OpenBatch } from './batching.js';

/** All SQL for media, batches, analyses and person evidence. */

export interface MediaRow {
  id: string;
  householdId: string;
  groupMessageId: string;
  mediaBatchId: string | null;
  sequence: number;
  providerMediaId: string;
  mimeType: string | null;
  storageKey: string | null;
  status: string;
  sharedAt: Date;
}

function toMediaRow(row: Record<string, unknown>): MediaRow {
  return {
    id: row['id'] as string,
    householdId: row['household_id'] as string,
    groupMessageId: row['group_message_id'] as string,
    mediaBatchId: (row['media_batch_id'] as string | null) ?? null,
    sequence: row['sequence'] as number,
    providerMediaId: row['provider_media_id'] as string,
    mimeType: (row['mime_type'] as string | null) ?? null,
    storageKey: (row['storage_key'] as string | null) ?? null,
    status: row['status'] as string,
    sharedAt: row['shared_at'] as Date,
  };
}

/**
 * Finds the share this photo belongs to, or starts a new one.
 *
 * The provider gives no grouping id, so the policy in batching.ts decides --
 * see the limitations documented there.
 */
export async function findOrCreateBatch(
  db: Db,
  input: {
    householdId: string;
    senderPersonId: string;
    sharedAt: Date;
    caption: string | null;
  },
): Promise<string> {
  const recent = await db.query(
    `SELECT b.id, b.household_id, b.sender_person_id,
            COALESCE(MAX(m.shared_at), b.shared_at) AS last_shared_at
       FROM media_batch b
       LEFT JOIN group_media m ON m.media_batch_id = b.id
      WHERE b.household_id = $1 AND b.sender_person_id = $2
      GROUP BY b.id
      ORDER BY last_shared_at DESC
      LIMIT 1`,
    [input.householdId, input.senderPersonId],
  );

  const row = recent.rows[0];
  if (row) {
    const open: OpenBatch = {
      id: row['id'] as string,
      householdId: row['household_id'] as string,
      senderPersonId: row['sender_person_id'] as string,
      lastSharedAt: row['last_shared_at'] as Date,
    };
    if (belongsToBatch(input, open)) {
      // Later messages in a share may carry the caption when the first did not.
      if (input.caption) {
        await db.query(
          `UPDATE media_batch SET caption = COALESCE(caption, $1), updated_at = now()
            WHERE id = $2`,
          [input.caption, open.id],
        );
      }
      return open.id;
    }
  }

  const created = await db.query(
    `INSERT INTO media_batch (household_id, sender_person_id, caption, shared_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.householdId, input.senderPersonId, input.caption, input.sharedAt],
  );
  return created.rows[0]!['id'] as string;
}

/**
 * Creates the media row, or returns the existing one for a redelivered webhook.
 * `created` is false when the provider media id was already known.
 */
export async function insertMedia(
  db: Db,
  input: {
    householdId: string;
    groupMessageId: string;
    mediaBatchId: string;
    sequence: number;
    providerMediaId: string;
    mimeType: string | null;
    sharedAt: Date;
  },
): Promise<{ media: MediaRow; created: boolean }> {
  const inserted = await db.query(
    `INSERT INTO group_media
       (household_id, group_message_id, media_batch_id, sequence, provider_media_id,
        mime_type, shared_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (household_id, provider_media_id) DO NOTHING
     RETURNING *`,
    [
      input.householdId,
      input.groupMessageId,
      input.mediaBatchId,
      input.sequence,
      input.providerMediaId,
      input.mimeType,
      input.sharedAt,
    ],
  );

  if (inserted.rows[0]) return { media: toMediaRow(inserted.rows[0]), created: true };

  const existing = await db.query(
    'SELECT * FROM group_media WHERE household_id = $1 AND provider_media_id = $2',
    [input.householdId, input.providerMediaId],
  );
  return { media: toMediaRow(existing.rows[0]!), created: false };
}

export async function nextSequenceInBatch(db: Db, batchId: string): Promise<number> {
  const result = await db.query(
    'SELECT COALESCE(MAX(sequence) + 1, 0) AS next FROM group_media WHERE media_batch_id = $1',
    [batchId],
  );
  return Number(result.rows[0]!['next']);
}

export async function markMediaStored(
  db: Db,
  input: {
    mediaId: string;
    storageKey: string;
    mimeType: string;
    byteSize: number;
    capturedAt: Date | null;
  },
): Promise<void> {
  await db.query(
    `UPDATE group_media
        SET status = 'stored', storage_key = $1, mime_type = $2, byte_size = $3,
            -- Cast explicitly: a bare parameter compared only with IS NULL
            -- gives Postgres nothing to infer a type from.
            captured_at = $4::timestamptz,
            captured_at_source =
              CASE WHEN $4::timestamptz IS NULL THEN NULL ELSE 'exif' END,
            captured_at_confidence =
              CASE WHEN $4::timestamptz IS NULL THEN NULL ELSE 'approximate' END,
            status_detail = NULL, updated_at = now()
      WHERE id = $5`,
    [input.storageKey, input.mimeType, input.byteSize, input.capturedAt, input.mediaId],
  );
}

/** The shape of the display copy, which decides which way a photo pans. */
export async function setMediaDisplaySize(
  db: Db,
  input: { mediaId: string; width: number; height: number },
): Promise<void> {
  await db.query(
    'UPDATE group_media SET display_width = $1, display_height = $2, updated_at = now() WHERE id = $3',
    [input.width, input.height, input.mediaId],
  );
}

export async function markMediaFailed(
  db: Db,
  input: { mediaId: string; status: 'download_failed' | 'storage_failed' | 'rejected'; detail: string },
): Promise<void> {
  await db.query(
    `UPDATE group_media SET status = $1, status_detail = $2, updated_at = now() WHERE id = $3`,
    [input.status, input.detail.slice(0, 500), input.mediaId],
  );
}

export async function findMediaById(db: Db, id: string): Promise<MediaRow | null> {
  const result = await db.query('SELECT * FROM group_media WHERE id = $1', [id]);
  return result.rows[0] ? toMediaRow(result.rows[0]) : null;
}

export async function findBatch(
  db: Db,
  batchId: string,
): Promise<{ caption: string | null; senderPersonId: string } | null> {
  const result = await db.query(
    'SELECT caption, sender_person_id FROM media_batch WHERE id = $1',
    [batchId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    caption: (row['caption'] as string | null) ?? null,
    senderPersonId: row['sender_person_id'] as string,
  };
}

export async function hasAcceptedAnalysis(db: Db, mediaId: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM media_analysis WHERE group_media_id = $1 AND status = 'accepted'`,
    [mediaId],
  );
  return result.rows.length > 0;
}

export async function insertAnalysis(
  db: Db,
  input: {
    mediaId: string;
    provider: string;
    model: string;
    schemaVersion: string;
    status: 'accepted' | 'rejected' | 'failed';
    error?: string | null;
    description?: string | null;
    peopleVisible?: number | null;
    proposal?: unknown;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO media_analysis
       (group_media_id, provider, model, schema_version, status, error, description,
        people_visible, proposal)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (group_media_id) WHERE status = 'accepted' DO NOTHING`,
    [
      input.mediaId,
      input.provider,
      input.model,
      input.schemaVersion,
      input.status,
      input.error ?? null,
      input.description ?? null,
      input.peopleVisible ?? null,
      input.proposal === undefined ? null : JSON.stringify(input.proposal),
    ],
  );
}

export interface EvidenceInput {
  mediaId: string;
  personId: string;
  evidenceType: 'human_correction' | 'explicit_assertion' | 'strong_context' | 'visual_match' | 'weak_context';
  confidence: 'high' | 'medium' | 'low';
  status: 'accepted' | 'proposed' | 'rejected';
  sourceMessageId: string | null;
}

/**
 * Records why Charlie thinks a person is in a photo. Unique per
 * (media, person, evidence_type), so re-running analysis cannot pile up
 * duplicate claims.
 */
export async function insertEvidence(db: Db, input: EvidenceInput): Promise<void> {
  await db.query(
    `INSERT INTO media_person_evidence
       (group_media_id, person_id, evidence_type, confidence, status, source_message_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (group_media_id, person_id, evidence_type) DO NOTHING`,
    [
      input.mediaId,
      input.personId,
      input.evidenceType,
      input.confidence,
      input.status,
      input.sourceMessageId,
    ],
  );
}

export async function updateBatchSummary(
  db: Db,
  batchId: string,
  summary: string,
): Promise<void> {
  await db.query(
    'UPDATE media_batch SET summary = COALESCE(summary, $1), updated_at = now() WHERE id = $2',
    [summary, batchId],
  );
}

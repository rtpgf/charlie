import type { Db } from '../db/index.js';
import { loadGroupGraph } from '../group/repository.js';
import { logger } from '../logger.js';
import type { InboundGroupMessage } from '../messaging/types.js';
import { OutboundMessageError } from '../messaging/types.js';
import { captionEvidenceForImage, mergeEvidence, visualEvidenceForImage } from './evidence.js';
import { readJpegCaptureTime } from './exif.js';
import {
  findOrCreateBatch,
  findMediaById,
  hasAcceptedAnalysis,
  insertAnalysis,
  insertEvidence,
  insertMedia,
  markMediaFailed,
  markMediaStored,
  nextSequenceInBatch,
  updateBatchSummary,
  type MediaRow,
} from './repository.js';
import { MediaRejectedError, validateDownload, type MediaFetcher } from './retrieve.js';
import { extensionForMimeType, mediaStorageKey, type MediaStore } from './store.js';
import { MEDIA_SCHEMA_VERSION, type MediaAnalyzer, type MediaInput } from './types.js';

/**
 * The media pipeline: retrieve, store durably, then understand.
 *
 * Ordered so that each stage can fail without costing the one before it. A
 * photo that is stored stays stored even if analysis never succeeds, and a
 * photo that cannot be downloaded is recorded as such rather than silently
 * dropped or endlessly retried.
 */

export interface MediaDeps {
  db: Db;
  fetcher?: MediaFetcher | undefined;
  store?: MediaStore | undefined;
  analyzer?: MediaAnalyzer | undefined;
}

export interface MediaIngestResult {
  stored: number;
  failed: number;
  duplicates: number;
}

export async function ingestMedia(
  message: InboundGroupMessage,
  sender: { householdId: string; personId: string },
  groupMessageId: string,
  deps: MediaDeps,
): Promise<MediaIngestResult> {
  const result: MediaIngestResult = { stored: 0, failed: 0, duplicates: 0 };
  if (message.media.length === 0) return result;

  const sharedAt = message.receivedAt;
  // WhatsApp puts the caption on the media item, and usually only on the first
  // photo of a share; the message text carries it for a text+media message.
  const caption = message.media.find((item) => item.caption)?.caption ?? message.text ?? null;

  const batchId = await findOrCreateBatch(deps.db, {
    householdId: sender.householdId,
    senderPersonId: sender.personId,
    sharedAt,
    caption: caption || null,
  });

  const stored: { row: MediaRow; bytes: Uint8Array; mimeType: string }[] = [];

  for (const item of message.media) {
    const sequence = await nextSequenceInBatch(deps.db, batchId);
    const { media, created } = await insertMedia(deps.db, {
      householdId: sender.householdId,
      groupMessageId,
      mediaBatchId: batchId,
      sequence,
      providerMediaId: item.externalMediaId,
      mimeType: item.mediaType ?? null,
      sharedAt,
    });

    // A redelivered webhook must not re-download or re-store anything.
    if (!created) {
      result.duplicates += 1;
      continue;
    }

    const outcome = await retrieveAndStore(media, deps);
    if (outcome) {
      stored.push({ row: media, bytes: outcome.bytes, mimeType: outcome.mimeType });
      result.stored += 1;
    } else {
      result.failed += 1;
    }
  }

  // Analysis is deliberately last and deliberately non-fatal: the photos are
  // already durable, and understanding them is an improvement, not a condition.
  if (stored.length > 0) {
    await analyzeStoredMedia(stored, { batchId, caption, groupMessageId, sender }, deps);
  }

  return result;
}

/** Returns the bytes when the photo became durable, or null when it did not. */
async function retrieveAndStore(
  media: MediaRow,
  deps: MediaDeps,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const logContext = { mediaId: media.id };

  if (!deps.fetcher || !deps.store) {
    logger.warn('media pipeline not configured, photo not retrieved', logContext);
    await markMediaFailed(deps.db, {
      mediaId: media.id,
      status: 'download_failed',
      detail: 'media fetcher or store not configured',
    });
    return null;
  }

  let download;
  try {
    download = await deps.fetcher.download(media.providerMediaId);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'unknown';
    logger.error('media download failed', {
      ...logContext,
      category: error instanceof OutboundMessageError ? error.category : 'unknown',
      detail,
    });
    await markMediaFailed(deps.db, { mediaId: media.id, status: 'download_failed', detail });
    return null;
  }

  // The provider's declared type is a claim about the bytes; only the bytes
  // are trusted, because only the bytes reach a vision model.
  let actualMimeType: string;
  try {
    actualMimeType = validateDownload(download);
  } catch (error: unknown) {
    const detail = error instanceof MediaRejectedError ? error.message : 'validation failed';
    logger.warn('media rejected', { ...logContext, detail });
    await markMediaFailed(deps.db, { mediaId: media.id, status: 'rejected', detail });
    return null;
  }

  const extension = extensionForMimeType(actualMimeType)!;
  const key = mediaStorageKey({
    householdId: media.householdId,
    mediaId: media.id,
    extension,
  });

  try {
    await deps.store.put(key, download.bytes, actualMimeType);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'unknown';
    logger.error('media storage failed', { ...logContext, detail });
    await markMediaFailed(deps.db, { mediaId: media.id, status: 'storage_failed', detail });
    return null;
  }

  // Capture time is preserved only when the file actually carries one. An
  // absent EXIF tag stays absent rather than falling back to shared_at.
  const capturedAt = actualMimeType === 'image/jpeg' ? readJpegCaptureTime(download.bytes) : null;

  await markMediaStored(deps.db, {
    mediaId: media.id,
    storageKey: key,
    mimeType: actualMimeType,
    byteSize: download.byteSize,
    capturedAt,
  });

  logger.info('media stored', {
    ...logContext,
    mimeType: actualMimeType,
    hasCaptureTime: capturedAt !== null,
  });

  return { bytes: download.bytes, mimeType: actualMimeType };
}

async function analyzeStoredMedia(
  stored: { row: MediaRow; bytes: Uint8Array; mimeType: string }[],
  context: {
    batchId: string;
    caption: string | null;
    groupMessageId: string;
    sender: { householdId: string; personId: string };
  },
  deps: MediaDeps,
): Promise<void> {
  const graph = await loadGroupGraph(deps.db, context.sender.householdId);
  const senderPerson = graph.people.find((person) => person.id === context.sender.personId);

  // Evidence from the human's own words does not depend on the model, so it is
  // recorded even when analysis is unavailable or fails.
  const fallbackVisible = stored.length === 1 ? 1 : 0;

  if (!deps.analyzer) {
    logger.warn('no media analyzer configured, photos stored without analysis', {
      batchId: context.batchId,
    });
    await recordCaptionEvidence(stored, context, graph, fallbackVisible, deps);
    return;
  }

  const media: MediaInput[] = stored.map((item) => ({
    mediaId: item.row.id,
    mimeType: item.mimeType,
    bytes: item.bytes,
  }));

  let proposal;
  try {
    proposal = await deps.analyzer.analyze({
      media,
      batchCaption: context.caption ?? undefined,
      sender: { preferredName: senderPerson?.preferredName ?? 'someone in the group' },
      knownPeople: graph.people.map((person) => ({
        preferredName: person.preferredName,
        aliases: [person.fullName, ...person.aliases].filter((n): n is string => Boolean(n)),
      })),
    });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'unknown';
    logger.error('media analysis failed', { batchId: context.batchId, detail });
    for (const item of stored) {
      await insertAnalysis(deps.db, {
        mediaId: item.row.id,
        provider: deps.analyzer.provider,
        model: deps.analyzer.model,
        schemaVersion: MEDIA_SCHEMA_VERSION,
        status: 'failed',
        error: detail.slice(0, 500),
      });
    }
    // The photos remain stored and available; only understanding is missing.
    await recordCaptionEvidence(stored, context, graph, fallbackVisible, deps);
    return;
  }

  const byId = new Map(proposal.images.map((image) => [image.mediaId, image]));

  for (const item of stored) {
    const image = byId.get(item.row.id);
    if (!image) {
      await insertAnalysis(deps.db, {
        mediaId: item.row.id,
        provider: deps.analyzer.provider,
        model: deps.analyzer.model,
        schemaVersion: MEDIA_SCHEMA_VERSION,
        status: 'rejected',
        error: 'analysis omitted this image',
      });
      continue;
    }

    await insertAnalysis(deps.db, {
      mediaId: item.row.id,
      provider: deps.analyzer.provider,
      model: deps.analyzer.model,
      schemaVersion: MEDIA_SCHEMA_VERSION,
      status: 'accepted',
      description: image.description,
      peopleVisible: image.peopleVisible,
      proposal: image,
    });

    // Human words first, model second, strongest claim per person kept.
    const evidence = mergeEvidence(
      captionEvidenceForImage(graph, context.caption, image.peopleVisible),
      visualEvidenceForImage(graph, image),
    );

    for (const claim of evidence) {
      await insertEvidence(deps.db, {
        mediaId: item.row.id,
        personId: claim.person.id,
        evidenceType: claim.evidenceType,
        confidence: claim.confidence,
        status: claim.status,
        sourceMessageId: context.groupMessageId,
      });
    }
  }

  if (proposal.batchSummary) {
    await updateBatchSummary(deps.db, context.batchId, proposal.batchSummary);
  }

  logger.info('media analysis succeeded', {
    batchId: context.batchId,
    imagesAnalyzed: proposal.images.length,
  });
}

async function recordCaptionEvidence(
  stored: { row: MediaRow }[],
  context: { caption: string | null; groupMessageId: string },
  graph: Awaited<ReturnType<typeof loadGroupGraph>>,
  peopleVisible: number,
  deps: MediaDeps,
): Promise<void> {
  for (const item of stored) {
    for (const claim of captionEvidenceForImage(graph, context.caption, peopleVisible)) {
      await insertEvidence(deps.db, {
        mediaId: item.row.id,
        personId: claim.person.id,
        evidenceType: claim.evidenceType,
        confidence: claim.confidence,
        status: claim.status,
        sourceMessageId: context.groupMessageId,
      });
    }
  }
}

/** Retry a single media item that failed retrieval. Used by the CLI. */
export async function reprocessMedia(
  db: Db,
  mediaId: string,
  deps: MediaDeps,
): Promise<'stored' | 'already_stored' | 'failed' | 'unknown_media'> {
  const media = await findMediaById(db, mediaId);
  if (!media) return 'unknown_media';
  if (media.status === 'stored' && (await hasAcceptedAnalysis(db, mediaId))) {
    return 'already_stored';
  }

  const outcome = await retrieveAndStore(media, { ...deps, db });
  return outcome ? 'stored' : 'failed';
}

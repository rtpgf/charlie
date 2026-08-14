import { describe, expect, it } from 'vitest';

import type { Db } from '../../src/db/index.js';
import { findPeopleByName } from '../../src/group/graph.js';
import { loadGroupGraph } from '../../src/group/repository.js';
import { ingestInboundMessage } from '../../src/messaging/service.js';
import { parseWhatsAppWebhook } from '../../src/messaging/whatsapp/parse.js';
import { getLatestBatch, getRecentMediaByPerson } from '../../src/media/gallery.js';
import { createSeededTestDb } from '../helpers/db.js';
import {
  failingAnalyzer,
  failingFetcher,
  failingStore,
  imageWebhook,
  jpegBytes,
  pdfBytes,
  recordingAnalyzer,
  recordingFetcher,
  recordingStore,
} from '../helpers/media.js';
import { JENNA_WHATSAPP_ID } from '../helpers/whatsapp.js';

const BLOCKED_WHATSAPP_ID = '12145550999';

async function seeded() {
  return createSeededTestDb({ whatsappSenderId: JENNA_WHATSAPP_ID });
}

function inbound(options: Parameters<typeof imageWebhook>[0]) {
  const [message] = parseWhatsAppWebhook(imageWebhook(options));
  return message!;
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    fetcher: recordingFetcher(),
    store: recordingStore(),
    analyzer: recordingAnalyzer(),
    ...overrides,
  };
}

async function mediaRows(db: Db) {
  const result = await db.query(
    `SELECT id, sequence, status, status_detail, storage_key, mime_type, shared_at,
            captured_at, captured_at_source, media_batch_id
       FROM group_media ORDER BY sequence`,
  );
  return result.rows;
}

describe('authorization', () => {
  it('retrieves media from an allowed member', async () => {
    const { db } = await seeded();
    const media = deps();

    await ingestInboundMessage(inbound({ mediaId: 'm1', messageId: 'wamid.1' }), { db, media });

    expect((media.fetcher as ReturnType<typeof recordingFetcher>).requested).toEqual(['m1']);
    expect(await mediaRows(db)).toHaveLength(1);
  });

  it('never retrieves media from a blocked member', async () => {
    const { db, householdId } = await seeded();
    const graph = await loadGroupGraph(db, householdId);
    const blocked = findPeopleByName(graph, 'Test Member')[0]!;
    await db.query(
      `INSERT INTO person_contact (person_id, channel, external_id) VALUES ($1,'whatsapp',$2)`,
      [blocked.id, BLOCKED_WHATSAPP_ID],
    );
    const media = deps();

    const outcome = await ingestInboundMessage(
      inbound({ mediaId: 'm1', messageId: 'wamid.1', from: BLOCKED_WHATSAPP_ID }),
      { db, media },
    );

    expect(outcome).toBe('ingestion_denied');
    // Never downloaded, never stored, never analyzed.
    expect((media.fetcher as ReturnType<typeof recordingFetcher>).requested).toEqual([]);
    expect((media.store as ReturnType<typeof recordingStore>).objects.size).toBe(0);
    expect((media.analyzer as ReturnType<typeof recordingAnalyzer>).calls).toEqual([]);
    expect(await mediaRows(db)).toHaveLength(0);
  });
});

describe('retrieval and validation', () => {
  it('stores a downloaded photo privately and records its key', async () => {
    const { db } = await seeded();
    const store = recordingStore();

    await ingestInboundMessage(inbound({ mediaId: 'm1', messageId: 'wamid.1' }), {
      db,
      media: deps({ store }),
    });

    const rows = await mediaRows(db);
    expect(rows[0]).toMatchObject({ status: 'stored', mime_type: 'image/jpeg' });
    expect(store.objects.has(rows[0]!['storage_key'] as string)).toBe(true);
  });

  it('rejects content that is not really an image', async () => {
    const { db } = await seeded();
    const store = recordingStore();

    // The provider claims image/jpeg; the bytes are a PDF.
    await ingestInboundMessage(inbound({ mediaId: 'm1', messageId: 'wamid.1' }), {
      db,
      media: deps({ fetcher: recordingFetcher({ bytes: pdfBytes() }), store }),
    });

    const rows = await mediaRows(db);
    expect(rows[0]!['status']).toBe('rejected');
    expect(store.objects.size).toBe(0);
  });

  it('rejects oversized media', async () => {
    const { db } = await seeded();
    const store = recordingStore();

    await ingestInboundMessage(inbound({ mediaId: 'm1', messageId: 'wamid.1' }), {
      db,
      media: deps({
        fetcher: recordingFetcher({ bytes: jpegBytes(), byteSize: 64 * 1024 * 1024 }),
        store,
      }),
    });

    expect((await mediaRows(db))[0]!['status']).toBe('rejected');
    expect(store.objects.size).toBe(0);
  });

  it('records a download failure without storing anything', async () => {
    const { db } = await seeded();
    const store = recordingStore();

    await ingestInboundMessage(inbound({ mediaId: 'm1', messageId: 'wamid.1' }), {
      db,
      media: deps({ fetcher: failingFetcher(), store }),
    });

    const rows = await mediaRows(db);
    expect(rows[0]!['status']).toBe('download_failed');
    expect(rows[0]!['status_detail']).toContain('404');
    expect(store.objects.size).toBe(0);
  });

  it('does not mark media durable when storage fails', async () => {
    const { db } = await seeded();

    await ingestInboundMessage(inbound({ mediaId: 'm1', messageId: 'wamid.1' }), {
      db,
      media: deps({ store: failingStore() }),
    });

    expect((await mediaRows(db))[0]!['status']).toBe('storage_failed');
  });
});

describe('storage privacy', () => {
  it('builds keys from opaque ids only', async () => {
    const { db } = await seeded();
    const store = recordingStore();

    await ingestInboundMessage(
      inbound({ mediaId: 'm1', messageId: 'wamid.1', caption: "Here's Natalie at the beach!" }),
      { db, media: deps({ store }) },
    );

    const key = [...store.objects.keys()][0]!;
    // No names, no phone numbers, no caption text -- the key space leaks nothing.
    for (const secret of ['Natalie', 'beach', 'Jenna', JENNA_WHATSAPP_ID, '2145']) {
      expect(key).not.toContain(secret);
    }
    expect(key).toMatch(/^groups\/[0-9a-f-]{36}\/media\/[0-9a-f-]{36}\.jpg$/);
  });

  it('hands out only time-limited URLs', async () => {
    const { db, householdId } = await seeded();
    const store = recordingStore();
    await ingestInboundMessage(inbound({ mediaId: 'm1', messageId: 'wamid.1' }), {
      db,
      media: deps({ store }),
    });

    const batch = (await getLatestBatch(db, householdId))!;
    const url = await store.getSignedUrl(batch.items[0]!.storageKey, 900);

    expect(url.startsWith('https://')).toBe(true);
    expect(store.signed[0]!.expiresIn).toBe(900);
  });
});

describe('multi-photo shares', () => {
  it('groups photos sent together into one batch, in order', async () => {
    const { db, householdId } = await seeded();
    const media = deps();

    for (const [index, id] of ['m1', 'm2', 'm3'].entries()) {
      await ingestInboundMessage(
        inbound({
          mediaId: id,
          messageId: `wamid.${index}`,
          // Only the first message carries the caption, as WhatsApp sends it.
          caption: index === 0 ? "Here's Natalie at the beach!" : undefined,
          timestamp: String(1786600000 + index),
        }),
        { db, media },
      );
    }

    const batch = (await getLatestBatch(db, householdId))!;
    expect(batch.items).toHaveLength(3);
    expect(batch.items.map((item) => item.sequence)).toEqual([0, 1, 2]);
    // The caption from the first message covers the whole share.
    expect(batch.caption).toBe("Here's Natalie at the beach!");
  });

  it('does not merge shares sent far apart', async () => {
    const { db } = await seeded();
    const media = deps();

    await ingestInboundMessage(
      inbound({ mediaId: 'm1', messageId: 'wamid.1', timestamp: '1786600000' }),
      { db, media },
    );
    await ingestInboundMessage(
      // Ten minutes later: a different moment, not the same share.
      inbound({ mediaId: 'm2', messageId: 'wamid.2', timestamp: '1786600600' }),
      { db, media },
    );

    const batches = await db.query('SELECT count(*)::int AS count FROM media_batch');
    expect(batches.rows[0]!['count']).toBe(2);
  });

  it('does not duplicate media on a redelivered webhook', async () => {
    const { db } = await seeded();
    const media = deps();
    const message = inbound({ mediaId: 'm1', messageId: 'wamid.1' });

    await ingestInboundMessage(message, { db, media });
    await ingestInboundMessage(message, { db, media });

    expect(await mediaRows(db)).toHaveLength(1);
    // And nothing was downloaded or stored a second time.
    expect((media.fetcher as ReturnType<typeof recordingFetcher>).requested).toEqual(['m1']);
    expect((media.store as ReturnType<typeof recordingStore>).objects.size).toBe(1);
  });
});

describe('dates', () => {
  it('always records when the family shared it', async () => {
    const { db } = await seeded();

    await ingestInboundMessage(inbound({ mediaId: 'm1', messageId: 'wamid.1' }), {
      db,
      media: deps(),
    });

    expect((await mediaRows(db))[0]!['shared_at']).toBeInstanceOf(Date);
  });

  it('never invents a capture time when the file carries none', async () => {
    const { db } = await seeded();

    await ingestInboundMessage(inbound({ mediaId: 'm1', messageId: 'wamid.1' }), {
      db,
      media: deps(),
    });

    const row = (await mediaRows(db))[0]!;
    expect(row['captured_at']).toBeNull();
    expect(row['captured_at_source']).toBeNull();
  });
});

describe('reprocessing', () => {
  it('completes the recovery, not just the download', async () => {
    const { db, householdId } = await seeded();
    const { reprocessMedia } = await import('../../src/media/service.js');

    // First attempt: storage unavailable, so the photo is never made durable.
    await ingestInboundMessage(
      inbound({ mediaId: 'm1', messageId: 'wamid.1', caption: "Here's Natalie at the beach!" }),
      { db, media: deps({ store: failingStore() }) },
    );
    const failed = (await mediaRows(db))[0]!;
    expect(failed['status']).toBe('storage_failed');

    const media = deps();
    const outcome = await reprocessMedia(db, failed['id'] as string, { db, ...media });

    expect(outcome).toBe('stored');
    // A photo recovered without analysis would sit in the gallery as an
    // unknown image, so reprocessing has to finish the job.
    const analysis = await db.query('SELECT status, description FROM media_analysis');
    expect(analysis.rows[0]!['status']).toBe('accepted');
    expect(analysis.rows[0]!['description']).not.toBeNull();

    const evidence = await db.query('SELECT evidence_type FROM media_person_evidence');
    expect(evidence.rows[0]!['evidence_type']).toBe('strong_context');
    expect(householdId).toBeTruthy();
  });

  it('does not redo work that already succeeded', async () => {
    const { db } = await seeded();
    const { reprocessMedia } = await import('../../src/media/service.js');
    const media = deps();

    await ingestInboundMessage(inbound({ mediaId: 'm1', messageId: 'wamid.1' }), { db, media });
    const stored = (await mediaRows(db))[0]!;

    const outcome = await reprocessMedia(db, stored['id'] as string, { db, ...media });

    expect(outcome).toBe('already_stored');
    const analyses = await db.query('SELECT count(*)::int AS count FROM media_analysis');
    expect(analyses.rows[0]!['count']).toBe(1);
  });
});

describe('analysis failure', () => {
  it('keeps the photo when vision analysis fails', async () => {
    const { db, householdId } = await seeded();

    await ingestInboundMessage(inbound({ mediaId: 'm1', messageId: 'wamid.1' }), {
      db,
      media: deps({ analyzer: failingAnalyzer() }),
    });

    expect((await mediaRows(db))[0]!['status']).toBe('stored');
    const batch = await getLatestBatch(db, householdId);
    expect(batch!.items).toHaveLength(1);

    const analysis = await db.query('SELECT status FROM media_analysis');
    expect(analysis.rows[0]!['status']).toBe('failed');
  });

  it('still learns from the caption when analysis fails', async () => {
    const { db, householdId } = await seeded();

    await ingestInboundMessage(
      inbound({ mediaId: 'm1', messageId: 'wamid.1', caption: "Here's Natalie at the beach!" }),
      { db, media: deps({ analyzer: failingAnalyzer() }) },
    );

    const graph = await loadGroupGraph(db, householdId);
    const natalie = findPeopleByName(graph, 'Natalie')[0]!;
    const photos = await getRecentMediaByPerson(db, { householdId, personId: natalie.id });
    expect(photos).toHaveLength(1);
  });
});

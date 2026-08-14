import { beforeAll, describe, expect, it } from 'vitest';

import { findPeopleByName, type GroupGraph } from '../../src/group/graph.js';
import { loadGroupGraph } from '../../src/group/repository.js';
import {
  captionEvidenceForImage,
  isAcceptable,
  mergeEvidence,
  outranks,
  peopleNamedInCaption,
  visualEvidenceForImage,
} from '../../src/media/evidence.js';
import { ingestInboundMessage } from '../../src/messaging/service.js';
import { parseWhatsAppWebhook } from '../../src/messaging/whatsapp/parse.js';
import { getRecentMediaByPerson } from '../../src/media/gallery.js';
import { createSeededTestDb } from '../helpers/db.js';
import { imageWebhook, recordingAnalyzer, recordingFetcher, recordingStore } from '../helpers/media.js';
import { JENNA_WHATSAPP_ID } from '../helpers/whatsapp.js';

let graph: GroupGraph;

beforeAll(async () => {
  const { db, householdId } = await createSeededTestDb();
  graph = await loadGroupGraph(db, householdId);
});

describe('the evidence hierarchy', () => {
  it('ranks human correction above every other kind', () => {
    for (const weaker of ['explicit_assertion', 'strong_context', 'visual_match', 'weak_context'] as const) {
      expect(outranks('human_correction', weaker)).toBe(true);
    }
  });

  it('ranks any human statement above what a model saw', () => {
    expect(outranks('explicit_assertion', 'visual_match')).toBe(true);
    expect(outranks('strong_context', 'visual_match')).toBe(true);
    expect(outranks('visual_match', 'strong_context')).toBe(false);
  });

  it('never lets weak context answer a question about someone', () => {
    expect(isAcceptable('weak_context')).toBe(false);
    expect(isAcceptable('strong_context')).toBe(true);
    expect(isAcceptable('visual_match')).toBe(true);
  });
});

describe('reading names out of a caption', () => {
  it('finds a known person by preferred name', () => {
    const found = peopleNamedInCaption(graph, "Here's Natalie at the beach!");
    expect(found.map((p) => p.preferredName)).toEqual(['Natalie']);
  });

  it('finds a known person by alias', () => {
    const found = peopleNamedInCaption(graph, 'James Thomas scored today');
    expect(found.map((p) => p.preferredName)).toEqual(['JT']);
  });

  it('ignores names Charlie does not know', () => {
    expect(peopleNamedInCaption(graph, 'Here is Bobby at the park')).toEqual([]);
  });
});

describe('what a caption is evidence of', () => {
  it('is strong evidence when one named person is the subject', () => {
    const [evidence] = captionEvidenceForImage(graph, "Here's Natalie at the beach!", 1);

    expect(evidence).toMatchObject({
      evidenceType: 'strong_context',
      confidence: 'high',
      status: 'accepted',
    });
  });

  it('is weak evidence over a crowd, and never accepted', () => {
    // "Natalie's soccer team!" does not mean every child is Natalie.
    const [evidence] = captionEvidenceForImage(graph, "Natalie's soccer team!", 11);

    expect(evidence).toMatchObject({
      evidenceType: 'weak_context',
      confidence: 'low',
      status: 'proposed',
    });
  });

  it('is weak when several people are named at once', () => {
    const evidence = captionEvidenceForImage(graph, 'Natalie and JT at the beach', 2);

    expect(evidence).toHaveLength(2);
    expect(evidence.every((item) => item.evidenceType === 'weak_context')).toBe(true);
  });

  it('produces nothing without a caption', () => {
    expect(captionEvidenceForImage(graph, null, 1)).toEqual([]);
  });
});

describe('what a model seeing someone is evidence of', () => {
  it('is always marked as a visual match, never a human statement', () => {
    const [evidence] = visualEvidenceForImage(graph, {
      mediaId: 'm1',
      description: 'a child on the sand',
      peopleVisible: 1,
      namedPeople: ['Natalie'],
    });

    expect(evidence).toMatchObject({ evidenceType: 'visual_match', status: 'proposed' });
  });

  it('never invents a person from a name Charlie does not know', () => {
    const evidence = visualEvidenceForImage(graph, {
      mediaId: 'm1',
      description: 'two children',
      peopleVisible: 2,
      namedPeople: ['Bobby', 'a stranger'],
    });

    expect(evidence).toEqual([]);
  });
});

describe('combining sources', () => {
  it('keeps the human statement when a model disagrees in strength', () => {
    const human = captionEvidenceForImage(graph, "Here's Natalie at the beach!", 1);
    const visual = visualEvidenceForImage(graph, {
      mediaId: 'm1',
      description: 'a child',
      peopleVisible: 1,
      namedPeople: ['Natalie'],
    });

    const merged = mergeEvidence(human, visual);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.evidenceType).toBe('strong_context');
  });
});

describe('learning from ordinary family language', () => {
  it('associates the named person with the photos they were sent with', async () => {
    const { db, householdId } = await createSeededTestDb({ whatsappSenderId: JENNA_WHATSAPP_ID });
    const [message] = parseWhatsAppWebhook(
      imageWebhook({ mediaId: 'm1', messageId: 'wamid.1', caption: "Here's Natalie at the beach!" }),
    );

    await ingestInboundMessage(message!, {
      db,
      media: {
        fetcher: recordingFetcher(),
        store: recordingStore(),
        analyzer: recordingAnalyzer({ peopleVisible: 1 }),
      },
    });

    const natalie = findPeopleByName(await loadGroupGraph(db, householdId), 'Natalie')[0]!;
    const photos = await getRecentMediaByPerson(db, { householdId, personId: natalie.id });

    // No tagging step, no Charlie-specific syntax -- just what Jenna wrote.
    expect(photos).toHaveLength(1);

    const evidence = await db.query(
      'SELECT evidence_type, status, source_message_id FROM media_person_evidence',
    );
    expect(evidence.rows[0]).toMatchObject({
      evidence_type: 'strong_context',
      status: 'accepted',
    });
    // Provenance points back at the message the words came from.
    expect(evidence.rows[0]!['source_message_id']).not.toBeNull();
  });

  it('does not claim a crowd photo is a picture of the named person', async () => {
    const { db, householdId } = await createSeededTestDb({ whatsappSenderId: JENNA_WHATSAPP_ID });
    const [message] = parseWhatsAppWebhook(
      imageWebhook({ mediaId: 'm1', messageId: 'wamid.1', caption: "Natalie's soccer team!" }),
    );

    await ingestInboundMessage(message!, {
      db,
      media: {
        fetcher: recordingFetcher(),
        store: recordingStore(),
        analyzer: recordingAnalyzer({ peopleVisible: 11 }),
      },
    });

    const natalie = findPeopleByName(await loadGroupGraph(db, householdId), 'Natalie')[0]!;

    // Charlie knows Natalie is associated with the occasion, but will not
    // answer "show me pictures of Natalie" with a photo of eleven children.
    const photos = await getRecentMediaByPerson(db, { householdId, personId: natalie.id });
    expect(photos).toEqual([]);

    const evidence = await db.query('SELECT evidence_type, status FROM media_person_evidence');
    expect(evidence.rows[0]).toMatchObject({ evidence_type: 'weak_context', status: 'proposed' });
  });

  it('creates no person for a face it does not recognize', async () => {
    const { db } = await createSeededTestDb({ whatsappSenderId: JENNA_WHATSAPP_ID });
    const [message] = parseWhatsAppWebhook(
      imageWebhook({ mediaId: 'm1', messageId: 'wamid.1', caption: 'Here with Bobby!' }),
    );

    await ingestInboundMessage(message!, {
      db,
      media: {
        fetcher: recordingFetcher(),
        store: recordingStore(),
        analyzer: recordingAnalyzer({ namedPeople: ['Bobby'] }),
      },
    });

    const people = await db.query('SELECT count(*)::int AS count FROM person');
    expect(people.rows[0]!['count']).toBe(5); // the five seeded people, unchanged
    const evidence = await db.query('SELECT count(*)::int AS count FROM media_person_evidence');
    expect(evidence.rows[0]!['count']).toBe(0);
  });
});

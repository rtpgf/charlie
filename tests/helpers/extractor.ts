import {
  EXTRACTION_SCHEMA_VERSION,
  type ExtractionContext,
  type KnowledgeExtractor,
  type KnowledgeProposal,
  type ProposedEvent,
} from '../../src/knowledge/types.js';

/**
 * Fake extractors. The normal suite never calls a provider — the abstraction
 * exists partly so this is possible without mocking HTTP.
 */

export interface RecordingExtractor extends KnowledgeExtractor {
  calls: ExtractionContext[];
}

export function emptyProposal(): KnowledgeProposal {
  return {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    peopleMentioned: [],
    events: [],
    facts: [],
    relationships: [],
    uncertainties: [],
  };
}

export function eventProposal(...events: Partial<ProposedEvent>[]): KnowledgeProposal {
  return {
    ...emptyProposal(),
    events: events.map((event) => ({
      subject: 'Jenna',
      activity: 'coming over',
      description: null,
      localDate: '2026-08-14',
      localTime: '15:00',
      datePrecision: 'day',
      timePrecision: 'approximate',
      status: 'planned',
      confidence: 'explicit',
      participants: ['Jenna'],
      ...event,
    })),
  };
}

/** Returns a fixed proposal and records what context it was given. */
export function stubExtractor(proposal: unknown = eventProposal({})): RecordingExtractor {
  const calls: ExtractionContext[] = [];
  return {
    calls,
    provider: 'stub',
    model: 'stub-model',
    extractFromMessage: async (context) => {
      calls.push(context);
      return proposal as KnowledgeProposal;
    },
  };
}

/** Fails a given number of times, then succeeds — for retry tests. */
export function flakyExtractor(failures: number, proposal = eventProposal({})): RecordingExtractor {
  const calls: ExtractionContext[] = [];
  let remaining = failures;
  return {
    calls,
    provider: 'stub',
    model: 'stub-model',
    extractFromMessage: async (context) => {
      calls.push(context);
      if (remaining > 0) {
        remaining -= 1;
        throw new Error('provider unavailable');
      }
      return proposal;
    },
  };
}

/** Never succeeds — stands in for missing or broken AI credentials. */
export function brokenExtractor(): RecordingExtractor {
  return flakyExtractor(Number.MAX_SAFE_INTEGER);
}

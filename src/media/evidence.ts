import { findPeopleByName, type GroupGraph, type Person } from '../group/graph.js';
import type { EvidenceInput } from './repository.js';
import type { ProposedMediaAnalysis } from './types.js';

/**
 * Turning what a human said and what a model saw into identity evidence.
 *
 * The rule this file exists to enforce: a caption is a claim about a *share*,
 * not about every face in every photo. "Here's Natalie at the beach" over four
 * photos of one child is strong evidence. The same words over a team photo of
 * twelve children is not evidence about any particular face.
 */

export type EvidenceType = EvidenceInput['evidenceType'];

/**
 * Strongest first. A later human correction must be able to outrank anything a
 * model concluded, so the order is a product rule, not an implementation
 * detail.
 */
export const EVIDENCE_STRENGTH: EvidenceType[] = [
  'human_correction',
  'explicit_assertion',
  'strong_context',
  'visual_match',
  'weak_context',
];

export function outranks(a: EvidenceType, b: EvidenceType): boolean {
  return EVIDENCE_STRENGTH.indexOf(a) < EVIDENCE_STRENGTH.indexOf(b);
}

/** Only these may be used to answer "show me pictures of Natalie". */
export function isAcceptable(type: EvidenceType): boolean {
  return type !== 'weak_context';
}

/**
 * How many visible people still counts as "the photo is about this person".
 * Above this, a caption naming someone tells Charlie who the *occasion*
 * involves, not which face is theirs.
 */
export const PROMINENT_SUBJECT_LIMIT = 2;

export interface CaptionEvidence {
  person: Person;
  evidenceType: EvidenceType;
  confidence: EvidenceInput['confidence'];
  status: EvidenceInput['status'];
}

/**
 * Resolves the people a caption names, against the group's own records only.
 * A name Charlie does not know produces nothing — no person is ever created
 * from a photo or a caption.
 */
export function peopleNamedInCaption(graph: GroupGraph, caption: string): Person[] {
  const found = new Map<string, Person>();

  // Match on the group's own names rather than parsing the sentence: Charlie
  // only cares about people it already knows, which is the closed world.
  for (const person of graph.people) {
    const names = [person.preferredName, person.fullName, ...person.aliases].filter(
      (name): name is string => Boolean(name),
    );
    for (const name of names) {
      const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (pattern.test(caption)) {
        found.set(person.id, person);
        break;
      }
    }
  }

  return [...found.values()];
}

/**
 * Evidence from the human's own words about one image.
 *
 * `peopleVisible` decides the strength: the same caption is strong evidence
 * over a photo of one person and weak evidence over a crowd.
 */
export function captionEvidenceForImage(
  graph: GroupGraph,
  caption: string | null,
  peopleVisible: number,
): CaptionEvidence[] {
  if (!caption) return [];

  const named = peopleNamedInCaption(graph, caption);
  if (named.length === 0) return [];

  // One name and one or two visible people: the caption is about that person.
  const prominent = named.length === 1 && peopleVisible > 0 && peopleVisible <= PROMINENT_SUBJECT_LIMIT;

  return named.map((person) => ({
    person,
    evidenceType: prominent ? ('strong_context' as const) : ('weak_context' as const),
    confidence: prominent ? ('high' as const) : ('low' as const),
    // Weak context is recorded but never accepted: Charlie knows Natalie is
    // associated with the occasion without claiming to know which face is hers.
    status: prominent ? ('accepted' as const) : ('proposed' as const),
  }));
}

/**
 * Evidence from what the model reported seeing.
 *
 * Always `visual_match`, always below any human statement, and always resolved
 * against known people — the model's names are matched, never trusted as ids.
 */
export function visualEvidenceForImage(
  graph: GroupGraph,
  analysis: ProposedMediaAnalysis,
): CaptionEvidence[] {
  const evidence: CaptionEvidence[] = [];

  for (const name of analysis.namedPeople) {
    const matches = findPeopleByName(graph, name);
    // An ambiguous or unknown name yields nothing, and never a new person.
    if (matches.length !== 1) continue;
    evidence.push({
      person: matches[0]!,
      evidenceType: 'visual_match',
      confidence: 'medium',
      // Proposed, not accepted: a model's visual guess should not by itself
      // answer "show me pictures of Natalie".
      status: 'proposed',
    });
  }

  return evidence;
}

/**
 * Combines the sources, keeping only the strongest claim per person so a photo
 * does not carry both a human statement and a weaker model guess about the
 * same person.
 */
export function mergeEvidence(...sets: CaptionEvidence[][]): CaptionEvidence[] {
  const best = new Map<string, CaptionEvidence>();

  for (const item of sets.flat()) {
    const existing = best.get(item.person.id);
    if (!existing || outranks(item.evidenceType, existing.evidenceType)) {
      best.set(item.person.id, item);
    }
  }

  return [...best.values()];
}

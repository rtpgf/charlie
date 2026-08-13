/**
 * The family model and the deterministic kinship rules over it.
 *
 * Everything here is pure and synchronous: a household's people and asserted
 * relationships are small enough to load in full and reason about in memory.
 * No SQL, no LLM. Derived kinship (aunt, uncle, niece, nephew) is computed
 * here and never stored -- only asserted facts live in the database.
 */

export type Gender = 'female' | 'male' | null;

export interface Person {
  id: string;
  fullName: string | null;
  preferredName: string;
  gender: Gender;
  /** Extra names this person answers to, beyond preferred and full name. */
  aliases: string[];
}

export type RelationshipType = 'parent_of' | 'sibling_of';

export interface Relationship {
  subjectId: string;
  type: RelationshipType;
  objectId: string;
}

export interface FamilyGraph {
  people: Person[];
  relationships: Relationship[];
}

/** Lowercased, trimmed, internal whitespace collapsed. */
function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Letters and digits only, so spoken spellings survive: "J T" and "J.T." both
 * become "jt". This is a general rule about punctuation and spacing, not a
 * special case for any particular person.
 */
function compact(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function namesFor(person: Person): string[] {
  return [person.preferredName, person.fullName, ...person.aliases].filter(
    (name): name is string => Boolean(name),
  );
}

/**
 * All people answering to a name, case-insensitively. Returns every match
 * rather than picking one, so callers can decline to guess when ambiguous.
 */
export function findPeopleByName(graph: FamilyGraph, spokenName: string): Person[] {
  const wanted = normalize(spokenName);
  if (!wanted) return [];

  const exact = graph.people.filter((person) =>
    namesFor(person).some((name) => normalize(name) === wanted),
  );
  if (exact.length > 0) return exact;

  // Only if nothing matched exactly, so "J T" can still find JT.
  const wantedCompact = compact(spokenName);
  if (!wantedCompact) return [];
  return graph.people.filter((person) =>
    namesFor(person).some((name) => compact(name) === wantedCompact),
  );
}

export function findPersonById(graph: FamilyGraph, personId: string): Person | undefined {
  return graph.people.find((person) => person.id === personId);
}

function peopleByIds(graph: FamilyGraph, ids: string[]): Person[] {
  return ids
    .map((id) => findPersonById(graph, id))
    .filter((person): person is Person => person !== undefined);
}

export function parentsOf(graph: FamilyGraph, personId: string): Person[] {
  const ids = graph.relationships
    .filter((rel) => rel.type === 'parent_of' && rel.objectId === personId)
    .map((rel) => rel.subjectId);
  return peopleByIds(graph, ids);
}

export function childrenOf(graph: FamilyGraph, personId: string): Person[] {
  const ids = graph.relationships
    .filter((rel) => rel.type === 'parent_of' && rel.subjectId === personId)
    .map((rel) => rel.objectId);
  return peopleByIds(graph, ids);
}

/**
 * sibling_of is symmetric, so it is matched from either side. Siblings are NOT
 * inferred from a shared parent -- that would assert a relationship nobody
 * stated, which Family Canon needs to keep distinguishable.
 */
export function siblingsOf(graph: FamilyGraph, personId: string): Person[] {
  const ids = graph.relationships
    .filter((rel) => rel.type === 'sibling_of')
    .flatMap((rel) => {
      if (rel.subjectId === personId) return [rel.objectId];
      if (rel.objectId === personId) return [rel.subjectId];
      return [];
    });
  return peopleByIds(graph, [...new Set(ids)]);
}

/** Derived: the siblings of this person's parents. */
export function auntsAndUnclesOf(graph: FamilyGraph, personId: string): Person[] {
  const ids = parentsOf(graph, personId)
    .flatMap((parent) => siblingsOf(graph, parent.id))
    .map((person) => person.id)
    .filter((id) => id !== personId);
  return peopleByIds(graph, [...new Set(ids)]);
}

/** Derived: the children of this person's siblings. */
export function niecesAndNephewsOf(graph: FamilyGraph, personId: string): Person[] {
  const ids = siblingsOf(graph, personId)
    .flatMap((sibling) => childrenOf(graph, sibling.id))
    .map((person) => person.id)
    .filter((id) => id !== personId);
  return peopleByIds(graph, [...new Set(ids)]);
}

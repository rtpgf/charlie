import {
  auntsAndUnclesOf,
  childrenOf,
  niecesAndNephewsOf,
  parentsOf,
  siblingsOf,
  type GroupGraph,
  type Gender,
  type Person,
} from './graph.js';

/**
 * Turns the derived kinship of one person into a spoken sentence.
 *
 * Nothing here is written for a particular person: the wording comes
 * from the relationships that exist and the gender recorded on the person, so
 * adding people to the household changes the answers with no code change.
 */

/** Gendered terms are used only where gender was explicitly recorded. */
function term(gender: Gender, female: string, male: string, neutral: string): string {
  if (gender === 'female') return female;
  if (gender === 'male') return male;
  return neutral;
}

const asChild = (g: Gender) => term(g, 'daughter', 'son', 'child');
const asParent = (g: Gender) => term(g, 'mother', 'father', 'parent');
const asSibling = (g: Gender) => term(g, 'sister', 'brother', 'sibling');
const asNieceNephew = (g: Gender) => term(g, 'niece', 'nephew', 'niece or nephew');
const asAuntUncle = (g: Gender) => term(g, 'aunt', 'uncle', 'aunt or uncle');

const subjectPronoun = (g: Gender) => term(g, "She's", "He's", "They're");

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}

/**
 * One relative reads naturally as a possessive ("Hannah's daughter"); several
 * read better the other way round ("the mother of Natalie and JT"), which also
 * avoids stacking two "and"s in one clause.
 */
function clause(relatives: Person[], relationTerm: string): string | null {
  if (relatives.length === 0) return null;
  const names = relatives.map((person) => person.preferredName);
  if (relatives.length === 1) return `${names[0]}'s ${relationTerm}`;
  return `the ${relationTerm} of ${joinNames(names)}`;
}

function joinClauses(clauses: string[]): string {
  if (clauses.length <= 2) return clauses.join(' and ');
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses.at(-1)}`;
}

/**
 * True when the full name adds something the preferred name does not already
 * convey. "Natalie" sits inside "Natalie Rose", so it is not worth saying;
 * "JT" does not appear in "James Thomas", so it is.
 */
function fullNameIsInformative(person: Person): boolean {
  if (!person.fullName) return false;
  return !person.fullName.toLowerCase().includes(person.preferredName.toLowerCase());
}

export function describePerson(graph: GroupGraph, person: Person): string {
  const gender = person.gender;

  const clauses = [
    clause(parentsOf(graph, person.id), asChild(gender)),
    clause(siblingsOf(graph, person.id), asSibling(gender)),
    clause(auntsAndUnclesOf(graph, person.id), asNieceNephew(gender)),
    clause(childrenOf(graph, person.id), asParent(gender)),
    clause(niecesAndNephewsOf(graph, person.id), asAuntUncle(gender)),
  ].filter((value): value is string => value !== null);

  const name = person.preferredName;

  if (clauses.length === 0) {
    return fullNameIsInformative(person)
      ? `${name} is ${person.fullName}, but I don't know yet how they're related to anyone.`
      : `I know about ${name}, but I don't know yet how they're related to anyone.`;
  }

  const relations = joinClauses(clauses);

  if (fullNameIsInformative(person)) {
    return `${name} is ${person.fullName}. ${subjectPronoun(gender)} ${relations}.`;
  }
  return `${name} is ${relations}.`;
}

import type { Db } from '../db/index.js';
import { describePerson } from './describe.js';
import { findPeopleByName } from './graph.js';
import { findHouseholdIdForAlexaUser, loadGroupGraph } from './repository.js';

/**
 * The application-layer entry points for group questions. The Alexa handler
 * calls these; it never touches SQL or walks relationships itself.
 */

export async function resolveHousehold(db: Db, alexaUserId: string): Promise<string | null> {
  return findHouseholdIdForAlexaUser(db, alexaUserId);
}

/**
 * Answers "who is <name>?" deterministically from stored group data.
 * Returns speech, including for the not-found and ambiguous cases, so the
 * handler has nothing to decide.
 */
export async function answerWhoIs(
  db: Db,
  householdId: string,
  spokenName: string,
): Promise<string> {
  const graph = await loadGroupGraph(db, householdId);
  const matches = findPeopleByName(graph, spokenName);

  if (matches.length === 0) {
    return `I don't think I know anyone named ${spokenName} yet.`;
  }

  if (matches.length > 1) {
    // Better to admit the ambiguity than to pick one and state it as fact.
    return `I know more than one person named ${spokenName}, so I'm not sure which one you mean.`;
  }

  return describePerson(graph, matches[0]!);
}

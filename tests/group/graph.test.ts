import { beforeAll, describe, expect, it } from 'vitest';

import { describePerson } from '../../src/group/describe.js';
import {
  auntsAndUnclesOf,
  childrenOf,
  findPeopleByName,
  niecesAndNephewsOf,
  parentsOf,
  siblingsOf,
  type GroupGraph,
  type Person,
} from '../../src/group/graph.js';
import { loadGroupGraph } from '../../src/group/repository.js';
import { createSeededTestDb } from '../helpers/db.js';

/**
 * Kinship rules exercised against the real seeded household, so these cover the
 * schema, the seed, and the derivation together rather than a hand-built graph.
 */
describe('group graph', () => {
  let graph: GroupGraph;

  beforeAll(async () => {
    const { db, householdId } = await createSeededTestDb();
    graph = await loadGroupGraph(db, householdId);
  });

  function person(name: string): Person {
    const matches = findPeopleByName(graph, name);
    expect(matches).toHaveLength(1);
    return matches[0]!;
  }

  describe('name resolution', () => {
    it('finds a person by preferred name', () => {
      expect(person('Natalie').preferredName).toBe('Natalie');
    });

    it('finds a person by full name', () => {
      expect(person('Natalie Rose').preferredName).toBe('Natalie');
    });

    it('matches case-insensitively', () => {
      expect(person('nATALIE').preferredName).toBe('Natalie');
      expect(person('jt').preferredName).toBe('JT');
    });

    it('resolves every alias to the same person', () => {
      for (const alias of ['JT', 'James', 'James Thomas']) {
        expect(person(alias).preferredName).toBe('JT');
      }
    });

    it('ignores spacing and punctuation in spoken spellings', () => {
      expect(person('J T').preferredName).toBe('JT');
      expect(person('J.T.').preferredName).toBe('JT');
    });

    it('returns nothing for an unknown name', () => {
      expect(findPeopleByName(graph, 'Robert')).toEqual([]);
    });
  });

  describe('asserted relationships', () => {
    it('reads a direct parent relationship', () => {
      expect(parentsOf(graph, person('Natalie').id).map((p) => p.preferredName)).toEqual(['Hannah']);
    });

    it('reads children of a parent', () => {
      const children = childrenOf(graph, person('Hannah').id).map((p) => p.preferredName);
      expect(children.sort()).toEqual(['JT', 'Natalie']);
    });

    it('reads a sibling relationship from the subject side', () => {
      expect(siblingsOf(graph, person('Jenna').id).map((p) => p.preferredName)).toEqual(['Hannah']);
    });

    it('reads the same sibling relationship from the object side', () => {
      expect(siblingsOf(graph, person('Hannah').id).map((p) => p.preferredName)).toEqual(['Jenna']);
    });

    it('does not invent siblings from a shared parent', () => {
      // Natalie and JT share a parent but no sibling_of was asserted.
      expect(siblingsOf(graph, person('Natalie').id)).toEqual([]);
    });
  });

  describe('derived relationships', () => {
    it('derives an aunt from sibling plus parent', () => {
      expect(auntsAndUnclesOf(graph, person('Natalie').id).map((p) => p.preferredName)).toEqual([
        'Jenna',
      ]);
    });

    it('derives the same aunt for the nephew', () => {
      expect(auntsAndUnclesOf(graph, person('JT').id).map((p) => p.preferredName)).toEqual([
        'Jenna',
      ]);
    });

    it('derives nieces and nephews in the other direction', () => {
      const nibling = niecesAndNephewsOf(graph, person('Jenna').id).map((p) => p.preferredName);
      expect(nibling.sort()).toEqual(['JT', 'Natalie']);
    });
  });

  describe('descriptions', () => {
    it('describes a niece using her parent and aunt', () => {
      expect(describePerson(graph, person('Natalie'))).toBe(
        "Natalie is Hannah's daughter and Jenna's niece.",
      );
    });

    it('introduces a full name when the preferred name does not contain it', () => {
      expect(describePerson(graph, person('JT'))).toBe(
        "JT is James Thomas. He's Hannah's son and Jenna's nephew.",
      );
    });

    it('describes a parent by her sibling and children', () => {
      expect(describePerson(graph, person('Hannah'))).toBe(
        "Hannah is Jenna's sister and the mother of Natalie and JT.",
      );
    });

    it('describes an aunt by her sibling and niblings', () => {
      expect(describePerson(graph, person('Jenna'))).toBe(
        "Jenna is Hannah's sister and the aunt of Natalie and JT.",
      );
    });
  });
});

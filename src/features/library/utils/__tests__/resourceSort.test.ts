import { describe, expect, it } from 'vitest';

import { sortResources } from '../resourceSort';

interface Item {
  name: string;
  usageCount: number;
  updatedAt: number;
}

const items: Item[] = [
  { name: 'b', usageCount: 1, updatedAt: 30 },
  { name: 'a', usageCount: 5, updatedAt: 10 },
  { name: 'c', usageCount: 3, updatedAt: 20 },
];

const pick = {
  name: (t: Item) => t.name,
  usage: (t: Item) => t.usageCount,
  updated: (t: Item) => t.updatedAt,
};

describe('sortResources', () => {
  it('sorts alphabetically', () => {
    expect(sortResources(items, 'alphabetical', pick).map((t) => t.name)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by usage descending', () => {
    expect(sortResources(items, 'frequent', pick).map((t) => t.name)).toEqual(['a', 'c', 'b']);
  });

  it('sorts by recency descending by default', () => {
    expect(sortResources(items, 'recent', pick).map((t) => t.name)).toEqual(['b', 'c', 'a']);
  });

  it('never mutates the input array', () => {
    const frozen = Object.freeze(items.map((t) => ({ ...t })));
    sortResources(frozen, 'alphabetical', pick);
    expect(frozen.map((t) => t.name)).toEqual(['b', 'a', 'c']);
  });
});

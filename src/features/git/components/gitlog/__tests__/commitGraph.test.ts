import { describe, it, expect } from 'vitest';

import type { CommitEntry } from '@/shared/types';

import { computeLayout } from '../CommitGraph';

function makeCommit(hash: string, parents: string[], shortHash = hash.slice(0, 7)): CommitEntry {
  return {
    hash,
    short_hash: shortHash,
    author: 'test',
    timestamp: '2024-01-01T00:00:00Z',
    message: 'test',
    refs: '',
    parents,
  };
}

describe('computeLayout', () => {
  it('handles empty commits', () => {
    const result = computeLayout([]);
    expect(result.nodes).toEqual([]);
    expect(result.segments).toEqual([]);
    expect(result.totalCols).toBe(0);
    expect(result.maxColUsed).toBe(0);
  });

  it('lays out a linear history in a single column', () => {
    const commits = [makeCommit('c1', ['c2']), makeCommit('c2', ['c3']), makeCommit('c3', [])];
    const { nodes, segments, totalCols, maxColUsed } = computeLayout(commits);

    expect(nodes).toHaveLength(3);
    expect(totalCols).toBe(1);
    expect(maxColUsed).toBe(0);

    // All nodes in column 0
    expect(nodes[0].x).toBe(0);
    expect(nodes[1].x).toBe(0);
    expect(nodes[2].x).toBe(0);

    // One continuous segment from row 0 to row 2
    expect(segments).toHaveLength(1);
    expect(segments[0].col).toBe(0);
    expect(segments[0].start).toBe(0);
    expect(segments[0].end).toBe(2);
  });

  it('lays out a branch + merge history', () => {
    //     c1 (merge)
    //    /  \
    //   c2   c3
    //   |
    //   c4
    const commits = [
      makeCommit('c1', ['c2', 'c3']),
      makeCommit('c2', ['c4']),
      makeCommit('c3', []),
      makeCommit('c4', []),
    ];
    const { nodes, segments } = computeLayout(commits);

    expect(nodes).toHaveLength(4);

    // c1 is the merge commit, should be on c2's column (branch child)
    const c1 = nodes.find((n) => n.hash === 'c1')!;
    const c2 = nodes.find((n) => n.hash === 'c2')!;
    const c3 = nodes.find((n) => n.hash === 'c3')!;
    const c4 = nodes.find((n) => n.hash === 'c4')!;

    expect(c1.x).toBe(c2.x); // merge commit sits on its first-parent column
    expect(c3.x).not.toBe(c2.x); // branch is on a different column

    // c4 should be on the same column as c2
    expect(c4.x).toBe(c2.x);

    // Segments should connect all visible commits (no truncation)
    const segForC2Col = segments.filter((s) => s.col === c2.x);
    expect(segForC2Col.length).toBeGreaterThanOrEqual(1);
    // The segment should span from c1 down to c4
    const mainSeg = segForC2Col[0];
    expect(mainSeg.start).toBeLessThanOrEqual(c1.y);
    expect(mainSeg.end).toBeGreaterThanOrEqual(c4.y);
  });

  it('truncates segments when parent is not in commits list', () => {
    // c1's parent p1 is missing from the list
    const commits = [makeCommit('c1', ['p1'])];
    const { segments } = computeLayout(commits);

    // Segment should end at row 0 (the commit itself) because parent is missing
    expect(segments).toHaveLength(1);
    expect(segments[0].start).toBe(0);
    expect(segments[0].end).toBe(0);
  });

  it('extends segments through visible parents', () => {
    const commits = [makeCommit('c1', ['c2']), makeCommit('c2', [])];
    const { segments } = computeLayout(commits);

    // The single segment spans from the HEAD (row 0) down to the root (row 1)
    expect(segments).toHaveLength(1);
    expect(segments[0].start).toBe(0);
    expect(segments[0].end).toBe(1);
  });

  it('edge endpoints connect to actual node centers', () => {
    const commits = [makeCommit('c1', ['c2']), makeCommit('c2', ['c3']), makeCommit('c3', [])];
    const { nodes } = computeLayout(commits);

    // All nodes should be in column 0
    expect(nodes.every((n) => n.x === 0)).toBe(true);

    // y positions should match index
    expect(nodes[0].y).toBe(0);
    expect(nodes[1].y).toBe(1);
    expect(nodes[2].y).toBe(2);
  });

  it('merge commit has correct parent references', () => {
    const commits = [
      makeCommit('merge', ['parent1', 'parent2']),
      makeCommit('parent1', []),
      makeCommit('parent2', []),
    ];
    const { nodes } = computeLayout(commits);
    const merge = nodes.find((n) => n.hash === 'merge')!;

    expect(merge.parents).toHaveLength(2);
    expect(merge.parents[0]).toBe('parent1');
    expect(merge.parents[1]).toBe('parent2');
  });
});

import { describe, it, expect } from 'vitest';

import type { CommitEntry } from '@/shared/types';

import { computeLayout, computeRowMaxX, bezierXAtY } from '../CommitGraph';

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

describe('bezierXAtY', () => {
  it('returns start X when targetY is at the start', () => {
    const p0: [number, number] = [8, 16];
    const p3: [number, number] = [20, 80];
    const [p1, p2] = [
      [p0[0] * 0.1 + p3[0] * 0.9, p0[1] * 0.6 + p3[1] * 0.4],
      [p0[0] * 0.03 + p3[0] * 0.97, p0[1] * 0.4 + p3[1] * 0.6],
    ] as [[number, number], [number, number]];
    expect(bezierXAtY(p0, p1, p2, p3, p0[1])).toBeCloseTo(p0[0], 5);
  });

  it('returns end X when targetY is at the end', () => {
    const p0: [number, number] = [8, 16];
    const p3: [number, number] = [20, 80];
    const [p1, p2] = [
      [p0[0] * 0.1 + p3[0] * 0.9, p0[1] * 0.6 + p3[1] * 0.4],
      [p0[0] * 0.03 + p3[0] * 0.97, p0[1] * 0.4 + p3[1] * 0.6],
    ] as [[number, number], [number, number]];
    expect(bezierXAtY(p0, p1, p2, p3, p3[1])).toBeCloseTo(p3[0], 5);
  });

  it('interpolates X for an interior Y (monotonic curve)', () => {
    // Pure diagonal line as bezier: p1/p2 on the straight line
    const p0: [number, number] = [0, 0];
    const p3: [number, number] = [100, 100];
    const p1: [number, number] = [100 / 3, 100 / 3];
    const p2: [number, number] = [200 / 3, 200 / 3];
    expect(bezierXAtY(p0, p1, p2, p3, 50)).toBeCloseTo(50, 2);
  });
});

describe('computeRowMaxX', () => {
  const NODE_RADIUS = 4;
  const BRANCH_SPACING = 6;
  const colX = (col: number) => col * BRANCH_SPACING + NODE_RADIUS * 2;

  it('empty commits', () => {
    expect(computeRowMaxX([])).toEqual([]);
  });

  it('linear history: every row maxX is the column-0 dot X', () => {
    const commits = [makeCommit('c1', ['c2']), makeCommit('c2', ['c3']), makeCommit('c3', [])];
    const rowMaxX = computeRowMaxX(commits);
    expect(rowMaxX).toHaveLength(3);
    for (const x of rowMaxX) expect(x).toBe(colX(0));
  });

  it('merge history: rows crossed by the merge curve get the wider X', () => {
    // merge (row0, col0) parents [main, feature]
    // feature branch: row1 col1 with its own child at row2 col1
    const commits = [
      makeCommit('merge', ['main', 'feature']),
      makeCommit('main', []),
      makeCommit('feature', []),
    ];
    const { nodes } = computeLayout(commits);
    const feature = nodes.find((n) => n.hash === 'feature')!;
    const rowMaxX = computeRowMaxX(commits);

    // Row 0 is the merge commit itself: the curve starts at its own dot,
    // so maxX is the merge's own column X.
    expect(rowMaxX[0]).toBe(colX(0));
    // Row 1 is crossed by the feature column vertical line (start=1) plus
    // the mid-path of the merge curve -> widest X.
    expect(rowMaxX[1]).toBe(colX(feature.x));
    // Row 2: feature dot at col1 -> wider X.
    expect(rowMaxX[2]).toBe(colX(feature.x));
  });

  it('crossing curve: intermediate row text starts right of the curve path, not the dot', () => {
    // A curve sweeping from col0 to col2 passes through the middle row;
    // that row's maxX must exceed its own dot X.
    const commits = [
      makeCommit('m', ['a', 'b']), // merge at col0, curves to col1 and col2 parents
      makeCommit('a', []),
      makeCommit('b', []),
    ];
    const { nodes } = computeLayout(commits);
    const b = nodes.find((n) => n.hash === 'b')!;
    const rowMaxX = computeRowMaxX(commits);

    // b lives at row2; curve merge->b spans rows 0..2. Row 1 is crossed
    // mid-path: its maxX is strictly between the two endpoint X values.
    expect(rowMaxX[1]).toBeGreaterThan(colX(0));
    expect(rowMaxX[1]).toBeLessThanOrEqual(colX(b.x));
  });

  it('rowMaxX is monotone non-decreasing in curve span X', () => {
    const commits = [makeCommit('c1', ['c2']), makeCommit('c2', [])];
    const rowMaxX = computeRowMaxX(commits);
    expect(rowMaxX).toHaveLength(2);
    expect(rowMaxX[0]).toBe(colX(0));
    expect(rowMaxX[1]).toBe(colX(0));
  });
});

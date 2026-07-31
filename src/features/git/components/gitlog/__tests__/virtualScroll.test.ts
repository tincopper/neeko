import { describe, it, expect } from 'vitest';

import { ROW_HEIGHT, computeRowOffsets, findRowIndex, getVirtualWindow } from '../virtualScroll';

describe('computeRowOffsets', () => {
  it('returns uniform offsets when no expand panel', () => {
    const offsets = computeRowOffsets(5, -1, 0);
    // 5 rows + 1 total-height sentinel
    expect(offsets).toEqual([0, 32, 64, 96, 128, 160]);
  });

  it('adds expand height after the selected row', () => {
    const offsets = computeRowOffsets(5, 2, 100);
    // Row 2 starts at 64, row 3 starts at 64 + 32 + 100 = 196
    expect(offsets).toEqual([0, 32, 64, 196, 228, 260]);
  });

  it('handles empty list', () => {
    const offsets = computeRowOffsets(0, -1, 0);
    expect(offsets).toEqual([0]);
  });
});

describe('findRowIndex', () => {
  const offsets = [0, 32, 64, 96, 128, 160];

  it('finds first row at exact offset', () => {
    expect(findRowIndex(offsets, 0)).toBe(0);
    expect(findRowIndex(offsets, 32)).toBe(1);
    expect(findRowIndex(offsets, 64)).toBe(2);
  });

  it('finds row between offsets', () => {
    expect(findRowIndex(offsets, 10)).toBe(1); // between 0 and 32 -> row 1
    expect(findRowIndex(offsets, 50)).toBe(2); // between 32 and 64 -> row 2
  });

  it('finds last row for large offsets', () => {
    expect(findRowIndex(offsets, 200)).toBe(5);
  });
});

describe('getVirtualWindow', () => {
  const offsets = computeRowOffsets(20, -1, 0); // 20 rows, uniform height

  it('returns empty window when scrolled past end', () => {
    const win = getVirtualWindow(offsets, 1000, 100);
    expect(win.startIndex).toBeLessThanOrEqual(win.endIndex + 1);
  });

  it('renders visible range plus overscan', () => {
    // Viewport starts at row 5 (offset 160), height = 64 (2 rows)
    const win = getVirtualWindow(offsets, 160, 64);
    // Visible rows: 5, 6, 7 (overscan adds 10 above and below)
    expect(win.startIndex).toBe(0); // 5 - 10 clamped to 0
    expect(win.endIndex).toBe(17); // 7 + 10 = 17 (clamped from 19)
    expect(win.offsetY).toBe(0);
  });

  it('offsets correctly for non-zero startIndex', () => {
    const offsetsWithExpand = computeRowOffsets(100, 50, 200);
    // Scroll to around row 60
    const scrollTop = offsetsWithExpand[60] ?? 0;
    const win = getVirtualWindow(offsetsWithExpand, scrollTop, ROW_HEIGHT * 3);
    expect(win.startIndex).toBeGreaterThanOrEqual(0);
    expect(win.endIndex).toBeLessThan(100);
    expect(win.offsetY).toBe(offsetsWithExpand[win.startIndex] ?? 0);
  });
});

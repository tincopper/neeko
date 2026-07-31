/**
 * Pure helpers for virtual scrolling the commit list.
 *
 * Kept separate from the React component so they can be unit-tested
 * without a DOM.
 */

export const ROW_HEIGHT = 32;
export const OVERSCAN = 10;

/**
 * Compute the pixel offset of every row, accounting for an inline
 * expand panel that adds extra height after a selected row.
 */
export function computeRowOffsets(
  rowCount: number,
  selectedRowIndex: number,
  expandHeight: number,
): number[] {
  const offsets: number[] = [];
  let y = 0;
  const hasExpand = selectedRowIndex >= 0 && expandHeight > 0;
  for (let i = 0; i < rowCount; i++) {
    offsets[i] = y;
    y += ROW_HEIGHT;
    if (hasExpand && i === selectedRowIndex) {
      y += expandHeight;
    }
  }
  offsets[rowCount] = y; // total height sentinel
  return offsets;
}

/**
 * Binary-search the first row whose offset is >= targetOffset.
 */
export function findRowIndex(offsets: number[], targetOffset: number): number {
  let lo = 0;
  let hi = offsets.length - 1; // exclude total-height sentinel
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] < targetOffset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Given scroll position and viewport size, return the inclusive
 * start/end indices to render, plus the translate-Y offset for the
 * first rendered row.
 */
export function getVirtualWindow(
  offsets: number[],
  scrollTop: number,
  viewportHeight: number,
  overscan = OVERSCAN,
): { startIndex: number; endIndex: number; offsetY: number } {
  const rowCount = offsets.length - 1;
  if (rowCount <= 0) {
    return { startIndex: 0, endIndex: -1, offsetY: 0 };
  }
  const startIndex = Math.max(0, findRowIndex(offsets, scrollTop) - overscan);
  const endIndex = Math.min(
    rowCount - 1,
    findRowIndex(offsets, scrollTop + viewportHeight) + overscan,
  );
  const offsetY = offsets[startIndex] ?? 0;
  return { startIndex, endIndex, offsetY };
}

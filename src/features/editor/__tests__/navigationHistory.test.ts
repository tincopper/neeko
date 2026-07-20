import { describe, expect, it } from 'vitest';

import {
  createNavigationHistory,
  sameNavLocation,
  type NavLocation,
} from '../navigationHistory';

function loc(file: string, line: number, column = 0): NavLocation {
  return {
    projectId: 'p1',
    tabKey: 'p1',
    filePath: file,
    line,
    column,
  };
}

describe('navigationHistory', () => {
  it('should_push_and_go_back_forward', () => {
    const h = createNavigationHistory();
    h.push(loc('a.ts', 1));
    h.push(loc('b.ts', 10));
    h.push(loc('c.ts', 3));

    expect(h.canBack()).toBe(true);
    expect(h.canForward()).toBe(false);

    expect(h.back()).toEqual(loc('b.ts', 10));
    expect(h.back()).toEqual(loc('a.ts', 1));
    expect(h.canBack()).toBe(false);

    expect(h.forward()).toEqual(loc('b.ts', 10));
    expect(h.forward()).toEqual(loc('c.ts', 3));
    expect(h.canForward()).toBe(false);
  });

  it('should_truncate_forward_branch_on_push', () => {
    const h = createNavigationHistory();
    h.push(loc('a.ts', 1));
    h.push(loc('b.ts', 2));
    h.push(loc('c.ts', 3));
    h.back();
    h.back();
    // at a
    h.push(loc('d.ts', 4));
    expect(h.current()).toEqual(loc('d.ts', 4));
    expect(h.canForward()).toBe(false);
    expect(h.snapshot().stack.map((s) => s.filePath)).toEqual(['a.ts', 'd.ts']);
  });

  it('should_dedupe_identical_consecutive_push', () => {
    const h = createNavigationHistory();
    h.push(loc('a.ts', 1));
    h.push(loc('a.ts', 1));
    expect(h.snapshot().stack).toHaveLength(1);
  });

  it('should_replace_tip', () => {
    const h = createNavigationHistory();
    h.push(loc('a.ts', 1));
    h.replaceTip(loc('a.ts', 5));
    expect(h.current()).toEqual(loc('a.ts', 5));
    expect(h.snapshot().stack).toHaveLength(1);
  });

  it('should_cap_max_entries', () => {
    const h = createNavigationHistory(3);
    h.push(loc('a.ts', 1));
    h.push(loc('b.ts', 1));
    h.push(loc('c.ts', 1));
    h.push(loc('d.ts', 1));
    expect(h.snapshot().stack.map((s) => s.filePath)).toEqual(['b.ts', 'c.ts', 'd.ts']);
    expect(h.current()?.filePath).toBe('d.ts');
  });

  it('sameNavLocation_compares_all_fields', () => {
    expect(sameNavLocation(loc('a.ts', 1), loc('a.ts', 1))).toBe(true);
    expect(sameNavLocation(loc('a.ts', 1), loc('a.ts', 2))).toBe(false);
  });
});

// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { DiffHunk, DiffLine, DiffResult } from '@/shared/types/git';

import { deriveFileLineChanges } from '../lineChange';

function context(text: string): DiffLine {
  return { Context: text };
}
function added(text: string): DiffLine {
  return { Added: text };
}
function removed(text: string): DiffLine {
  return { Removed: text };
}
function collapsed(text: string): DiffLine {
  return { Collapsed: text };
}

function hunk(partial: Partial<DiffHunk> & { lines: DiffLine[] }): DiffHunk {
  return {
    old_start: 1,
    old_lines: 0,
    new_start: 1,
    new_lines: 0,
    ...partial,
  };
}

function result(hunks: DiffHunk[], truncated = false): DiffResult {
  return { hunks, truncated };
}

describe('deriveFileLineChanges', () => {
  it('should_return_empty_for_empty_hunks', () => {
    expect(deriveFileLineChanges(result([]))).toEqual([]);
  });

  it('should_return_empty_when_only_context', () => {
    const diff = result([
      hunk({
        old_start: 5,
        new_start: 5,
        lines: [context('a'), context('b'), context('c')],
      }),
    ]);
    expect(deriveFileLineChanges(diff)).toEqual([]);
  });

  it('should_mark_pure_added_lines_from_untracked_fallback', () => {
    const diff = result([
      hunk({
        old_start: 0,
        new_start: 1,
        lines: [added('line1'), added('line2'), added('line3')],
      }),
    ]);
    expect(deriveFileLineChanges(diff)).toEqual([
      { line: 1, kind: 'added' },
      { line: 2, kind: 'added' },
      { line: 3, kind: 'added' },
    ]);
  });

  it('should_pair_removed_and_added_as_modified_with_word_ranges', () => {
    const diff = result([
      hunk({
        old_start: 10,
        new_start: 10,
        lines: [context('keep'), removed('const a = 1;'), added('const a = 2;'), context('tail')],
      }),
    ]);
    const changes = deriveFileLineChanges(diff);
    expect(changes).toHaveLength(1);
    expect(changes[0].line).toBe(11);
    expect(changes[0].kind).toBe('modified');
    expect(changes[0].words).toBeDefined();
    expect(changes[0].words!.length).toBeGreaterThan(0);
    const lineText = 'const a = 2;';
    for (const w of changes[0].words!) {
      expect(w.from).toBeGreaterThanOrEqual(0);
      expect(w.to).toBeLessThanOrEqual(lineText.length);
      expect(w.to).toBeGreaterThan(w.from);
    }
    expect(lineText.slice(changes[0].words![0].from, changes[0].words![0].to)).toBe('2');
  });

  it('should_mark_extra_added_lines_beyond_pair_as_added', () => {
    const diff = result([
      hunk({
        old_start: 1,
        new_start: 1,
        lines: [removed('old'), added('new1'), added('new2')],
      }),
    ]);
    expect(deriveFileLineChanges(diff)).toEqual([
      { line: 1, kind: 'modified', words: expect.any(Array) },
      { line: 2, kind: 'added' },
    ]);
  });

  it('should_drop_unpaired_removed_lines', () => {
    const diff = result([
      hunk({
        old_start: 1,
        new_start: 1,
        lines: [removed('gone1'), removed('gone2'), added('kept')],
      }),
    ]);
    const changes = deriveFileLineChanges(diff);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ line: 1, kind: 'modified' });
  });

  it('should_produce_no_entries_for_pure_removals', () => {
    const diff = result([
      hunk({
        old_start: 3,
        new_start: 3,
        lines: [context('a'), removed('x'), removed('y'), context('b')],
      }),
    ]);
    expect(deriveFileLineChanges(diff)).toEqual([]);
  });

  it('should_advance_new_line_numbers_across_context_and_hunks', () => {
    const diff = result([
      hunk({
        old_start: 1,
        new_start: 1,
        lines: [context('c1'), context('c2'), removed('r'), added('a'), context('c3')],
      }),
      hunk({
        old_start: 20,
        new_start: 21,
        lines: [added('later')],
      }),
    ]);
    const changes = deriveFileLineChanges(diff);
    expect(changes.map((c) => c.line)).toEqual([3, 21]);
    expect(changes[0].kind).toBe('modified');
    expect(changes[1].kind).toBe('added');
  });

  it('should_advance_new_line_numbers_past_collapsed_context', () => {
    const diff = result([
      hunk({
        old_start: 1,
        new_start: 1,
        lines: [context('c1'), collapsed('4 unmodified lines'), context('c8'), added('x')],
      }),
    ]);
    const changes = deriveFileLineChanges(diff);
    // c1=1，折叠 4 行=2..5，c8=6，added x=7
    expect(changes).toEqual([{ line: 7, kind: 'added' }]);
  });

  it('should_handle_standalone_added_run_after_context', () => {
    const diff = result([
      hunk({
        old_start: 1,
        new_start: 1,
        lines: [context('c'), added('n1'), added('n2')],
      }),
    ]);
    expect(deriveFileLineChanges(diff)).toEqual([
      { line: 2, kind: 'added' },
      { line: 3, kind: 'added' },
    ]);
  });

  it('should_dedupe_and_sort_by_line', () => {
    const diff = result([
      hunk({ new_start: 5, lines: [added('b')] }),
      hunk({ new_start: 2, lines: [added('a')] }),
      hunk({ new_start: 5, lines: [added('b-again')] }),
    ]);
    const changes = deriveFileLineChanges(diff);
    expect(changes.map((c) => c.line)).toEqual([2, 5]);
  });

  it('should_return_partial_map_when_truncated', () => {
    const diff = result([hunk({ new_start: 1, lines: [added('only')] })], true);
    expect(deriveFileLineChanges(diff)).toEqual([{ line: 1, kind: 'added' }]);
  });

  it('should_omit_words_for_identical_paired_lines', () => {
    const diff = result([
      hunk({
        old_start: 1,
        new_start: 1,
        lines: [removed('same'), added('same')],
      }),
    ]);
    const changes = deriveFileLineChanges(diff);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('modified');
    expect(changes[0].words ?? []).toEqual([]);
  });
});

describe('buildWordRanges (via derive)', () => {
  it('should_cover_full_replacement_range', () => {
    const diff = result([
      hunk({
        old_start: 1,
        new_start: 1,
        lines: [removed('alpha'), added('beta')],
      }),
    ]);
    const [change] = deriveFileLineChanges(diff);
    expect(change.words).toEqual([{ from: 0, to: 4 }]);
  });

  it('should_handle_cjk_and_empty_old_text', () => {
    const diff = result([
      hunk({
        old_start: 1,
        new_start: 1,
        lines: [added('你好世界')],
      }),
    ]);
    expect(deriveFileLineChanges(diff)).toEqual([{ line: 1, kind: 'added' }]);

    const insert = result([
      hunk({
        old_start: 1,
        new_start: 1,
        lines: [removed(''), added('你好')],
      }),
    ]);
    const [c] = deriveFileLineChanges(insert);
    expect(c.kind).toBe('modified');
    expect(c.words).toEqual([{ from: 0, to: 2 }]);
  });
});

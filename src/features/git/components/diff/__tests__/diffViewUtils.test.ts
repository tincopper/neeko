import { describe, expect, it } from 'vitest';

import {
  splitFilePath,
  fileBlockId,
  statusLetter,
  sumFileStats,
  initialExpandedPaths,
  indexOfPath,
  computeSelectionRange,
  selectionKeys,
  mergeSelection,
  parseCollapsedCount,
  collapsedSectionRanges,
  spliceFullHunkSection,
  findFullHunkForOldLine,
} from '../diffViewUtils';
import type { CommitFileChange, DiffHunk, DiffLine } from '../types';

function f(path: string): CommitFileChange {
  return { path, status: 'M', additions: 1, deletions: 0 };
}

describe('splitFilePath', () => {
  it('should_split_name_and_dir', () => {
    expect(splitFilePath('src/app/DockBarButton.tsx')).toEqual({
      name: 'DockBarButton.tsx',
      dir: 'src/app',
    });
  });
});

describe('fileBlockId', () => {
  it('should_sanitize_path_separators', () => {
    expect(fileBlockId('src/app/x.tsx')).toBe('fileblock-src_app_x.tsx');
  });
});

describe('statusLetter', () => {
  it('should_normalize_status_words_and_letters', () => {
    expect(statusLetter('modified')).toBe('M');
    expect(statusLetter('A')).toBe('A');
    expect(statusLetter('deleted')).toBe('D');
  });
});

describe('sumFileStats', () => {
  it('should_sum_additions_and_deletions', () => {
    expect(
      sumFileStats([
        { path: 'a', status: 'M', additions: 3, deletions: 1 },
        { path: 'b', status: 'A', additions: 10, deletions: 0 },
      ]),
    ).toEqual({ additions: 13, deletions: 1 });
  });
});

describe('initialExpandedPaths', () => {
  it('should_expand_all_when_three_or_fewer', () => {
    const files = [f('a'), f('b'), f('c')];
    expect(initialExpandedPaths(files).size).toBe(3);
  });

  it('should_expand_only_preferred_when_many_files', () => {
    const files = [f('a'), f('b'), f('c'), f('d')];
    const set = initialExpandedPaths(files, 'c');
    expect([...set]).toEqual(['c']);
  });

  it('should_fallback_to_first_when_preferred_missing', () => {
    const files = [f('a'), f('b'), f('c'), f('d')];
    expect([...initialExpandedPaths(files, 'missing')]).toEqual(['a']);
  });
});

describe('indexOfPath', () => {
  it('should_return_index_or_minus_one', () => {
    const files = [f('a'), f('b')];
    expect(indexOfPath(files, 'b')).toBe(1);
    expect(indexOfPath(files, null)).toBe(-1);
  });
});

describe('computeSelectionRange', () => {
  it('should_normalize_downward_drag', () => {
    expect(computeSelectionRange({ hunk: 1, line: 3 }, { hunk: 0, line: 1 })).toEqual({
      start: { hunk: 0, line: 1 },
      end: { hunk: 1, line: 3 },
    });
  });

  it('should_keep_anchor_first_when_same_hunk_downward', () => {
    expect(computeSelectionRange({ hunk: 0, line: 1 }, { hunk: 0, line: 4 })).toEqual({
      start: { hunk: 0, line: 1 },
      end: { hunk: 0, line: 4 },
    });
  });

  it('should_swap_when_dragging_upward_in_same_hunk', () => {
    expect(computeSelectionRange({ hunk: 2, line: 5 }, { hunk: 2, line: 2 })).toEqual({
      start: { hunk: 2, line: 2 },
      end: { hunk: 2, line: 5 },
    });
  });
});

describe('selectionKeys', () => {
  // 三个 hunk，行数分别为 3 / 4 / 2
  const lineCounts = [3, 4, 2];

  it('should_build_keys_within_single_hunk', () => {
    const keys = selectionKeys({ hunk: 1, line: 1 }, { hunk: 1, line: 3 }, lineCounts);
    expect([...keys].sort()).toEqual(['1:1', '1:2', '1:3']);
  });

  it('should_include_full_middle_hunks_when_crossing', () => {
    const keys = selectionKeys({ hunk: 0, line: 1 }, { hunk: 2, line: 1 }, lineCounts);
    expect([...keys].sort()).toEqual(['0:1', '0:2', '1:0', '1:1', '1:2', '1:3', '2:0', '2:1']);
  });

  it('should_apply_prefix_for_combined_mode', () => {
    const keys = selectionKeys({ hunk: 0, line: 0 }, { hunk: 0, line: 1 }, lineCounts, 'src/a.ts');
    expect([...keys].sort()).toEqual(['src/a.ts\u00000:0', 'src/a.ts\u00000:1']);
  });
});

describe('mergeSelection', () => {
  it('should_replace_previous_selection', () => {
    const prev = new Set(['0:0', '0:1']);
    const next = mergeSelection(prev, new Set(['1:2', '1:3']), 'replace');
    expect([...next].sort()).toEqual(['1:2', '1:3']);
  });

  it('should_append_to_previous_selection', () => {
    const prev = new Set(['0:0', '0:1']);
    const next = mergeSelection(prev, new Set(['1:2']), 'append');
    expect([...next].sort()).toEqual(['0:0', '0:1', '1:2']);
  });

  it('should_not_mutate_input_set', () => {
    const prev = new Set(['0:0']);
    mergeSelection(prev, new Set(['1:0']), 'replace');
    expect(prev.has('0:0')).toBe(true);
  });
});

describe('parseCollapsedCount', () => {
  it('should_parse_plural_and_singular', () => {
    expect(parseCollapsedCount('12 unmodified lines')).toBe(12);
    expect(parseCollapsedCount('1 unmodified line')).toBe(1);
  });

  it('should_return_zero_for_unknown_text', () => {
    expect(parseCollapsedCount('random text')).toBe(0);
  });
});

describe('collapsedSectionRanges', () => {
  function context(text: string): DiffLine {
    return { Context: text };
  }

  function makeHunk(): DiffHunk {
    // old_start=1：前 3 行 context、折叠标记(4 行)、后 3 行 context、变更行
    return {
      old_start: 1,
      old_lines: 12,
      new_start: 1,
      new_lines: 12,
      lines: [
        context('c1'),
        context('c2'),
        context('c3'),
        { Collapsed: '4 unmodified lines' },
        context('c8'),
        context('c9'),
        context('c10'),
        { Removed: 'old' },
        { Added: 'new' },
      ],
    };
  }

  it('should_compute_hidden_old_and_new_ranges', () => {
    const ranges = collapsedSectionRanges(makeHunk());
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({
      index: 3,
      oldStart: 4,
      oldEnd: 7,
      newStart: 4,
      newEnd: 7,
    });
  });
});

describe('spliceFullHunkSection', () => {
  function context(text: string): DiffLine {
    return { Context: text };
  }

  it('should_extract_hidden_context_lines_from_full_hunk', () => {
    // 全量 hunk：包含被折叠的 4 行（c4-c7）
    const fullHunk: DiffHunk = {
      old_start: 1,
      old_lines: 12,
      new_start: 1,
      new_lines: 12,
      lines: [
        context('c1'),
        context('c2'),
        context('c3'),
        context('c4'),
        context('c5'),
        context('c6'),
        context('c7'),
        context('c8'),
        context('c9'),
        context('c10'),
        { Removed: 'old' },
        { Added: 'new' },
      ],
    };
    const spliced = spliceFullHunkSection(fullHunk, {
      index: 3,
      oldStart: 4,
      oldEnd: 7,
      newStart: 4,
      newEnd: 7,
    });
    expect(spliced.map((l) => l.Context)).toEqual(['c4', 'c5', 'c6', 'c7']);
  });
});

describe('findFullHunkForOldLine', () => {
  it('should_find_hunk_containing_old_line', () => {
    const h1: DiffHunk = { old_start: 1, old_lines: 10, new_start: 1, new_lines: 10, lines: [] };
    const h2: DiffHunk = { old_start: 20, old_lines: 5, new_start: 20, new_lines: 5, lines: [] };
    expect(findFullHunkForOldLine([h1, h2], 22)).toBe(h2);
    expect(findFullHunkForOldLine([h1, h2], 5)).toBe(h1);
  });

  it('should_return_null_when_not_found', () => {
    const h1: DiffHunk = { old_start: 1, old_lines: 10, new_start: 1, new_lines: 10, lines: [] };
    expect(findFullHunkForOldLine([h1], 99)).toBeNull();
  });
});

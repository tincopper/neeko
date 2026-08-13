import { describe, expect, it } from 'vitest';

import { capDiffText, hunksToDiffText, hunksToSelectedDiffText } from '../diffText';
import type { DiffHunk } from '../types';

describe('capDiffText', () => {
  it('should_keep_text_within_limit_unchanged', () => {
    expect(capDiffText('short diff', 100)).toBe('short diff');
  });

  it('should_truncate_oversized_text_with_marker', () => {
    const result = capDiffText('a'.repeat(50), 20);
    expect(result).toContain('a'.repeat(20));
    expect(result).toContain('[diff truncated: 30 chars omitted]');
  });

  it('should_keep_text_exactly_at_limit_unchanged', () => {
    expect(capDiffText('x'.repeat(10), 10)).toBe('x'.repeat(10));
  });

  it('should_return_empty_string_for_empty_input', () => {
    expect(capDiffText('', 10)).toBe('');
  });

  it('should_default_to_diFF_TEXT_MAX_CHARS', () => {
    expect(capDiffText('ok')).toBe('ok');
  });
});

describe('hunksToDiffText', () => {
  it('should_render_added_context_removed_with_new_side_line_numbers', () => {
    const hunk: DiffHunk = {
      old_start: 10,
      old_lines: 3,
      new_start: 10,
      new_lines: 3,
      lines: [{ Context: 'keep' }, { Removed: 'gone' }, { Added: 'added' }],
    };
    expect(hunksToDiffText([hunk])).toBe(
      ['@@ -10,3 +10,3 @@', '  10| keep', '   -| gone', '  11| added'].join('\n'),
    );
  });

  it('should_render_collapsed_lines_as_ellipsis', () => {
    const hunk: DiffHunk = {
      old_start: 1,
      old_lines: 2,
      new_start: 1,
      new_lines: 2,
      lines: [{ Collapsed: '2 unmodified lines' }, { Added: 'x' }],
    };
    expect(hunksToDiffText([hunk])).toBe(['@@ -1,2 +1,2 @@', '  …', '  1| x'].join('\n'));
  });

  it('should_emit_hunk_header_per_hunk', () => {
    const hunkA: DiffHunk = {
      old_start: 1,
      old_lines: 1,
      new_start: 1,
      new_lines: 1,
      lines: [{ Added: 'a' }],
    };
    const hunkB: DiffHunk = {
      old_start: 5,
      old_lines: 1,
      new_start: 5,
      new_lines: 1,
      lines: [{ Added: 'b' }],
    };
    expect(hunksToDiffText([hunkA, hunkB])).toBe(
      ['@@ -1,1 +1,1 @@', '  1| a', '@@ -5,1 +5,1 @@', '  5| b'].join('\n'),
    );
  });

  it('should_return_empty_string_for_empty_hunks', () => {
    expect(hunksToDiffText([])).toBe('');
  });
});

describe('hunksToSelectedDiffText', () => {
  const hunk: DiffHunk = {
    old_start: 10,
    old_lines: 3,
    new_start: 10,
    new_lines: 3,
    lines: [{ Context: 'keep' }, { Removed: 'gone' }, { Added: 'added' }],
  };

  it('should_output_only_selected_lines_with_old_and_new_line_numbers', () => {
    const selected = new Set(['0:0', '0:2']);
    expect(hunksToSelectedDiffText([hunk], selected)).toBe(
      ['10|10| keep', '-|11| added'].join('\n'),
    );
  });

  it('should_placeholder_missing_side_with_dash_for_removed_line', () => {
    const selected = new Set(['0:1']);
    expect(hunksToSelectedDiffText([hunk], selected)).toBe('11|-| gone');
  });

  it('should_output_only_selected_hunk_lines_across_hunks', () => {
    const hunkA: DiffHunk = {
      old_start: 1,
      old_lines: 1,
      new_start: 1,
      new_lines: 1,
      lines: [{ Added: 'a' }],
    };
    const hunkB: DiffHunk = {
      old_start: 5,
      old_lines: 1,
      new_start: 5,
      new_lines: 1,
      lines: [{ Added: 'b' }],
    };
    const selected = new Set(['1:0']);
    expect(hunksToSelectedDiffText([hunkA, hunkB], selected)).toBe('-|5| b');
  });

  it('should_render_selected_collapsed_line_as_ellipsis', () => {
    const collapsedHunk: DiffHunk = {
      old_start: 1,
      old_lines: 2,
      new_start: 1,
      new_lines: 2,
      lines: [{ Collapsed: '2 unmodified lines' }, { Added: 'x' }],
    };
    const selected = new Set(['0:0']);
    expect(hunksToSelectedDiffText([collapsedHunk], selected)).toBe('…');
  });

  it('should_return_empty_string_for_empty_selection', () => {
    expect(hunksToSelectedDiffText([hunk], new Set())).toBe('');
  });
});

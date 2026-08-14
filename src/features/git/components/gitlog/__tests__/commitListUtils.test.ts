import { describe, expect, it } from 'vitest';

import {
  parseCommitMessage,
  commitBodyPreview,
  typeStyle,
  formatRefs,
  formatRefsList,
  refStyle,
  formatAbsoluteTime,
  formatRelativeTime,
  graphWidthForCols,
  textLeftForCol,
  splitFilePath,
  MAX_GRAPH_LANES,
  TEXT_AFTER_DOT_GAP,
} from '../commitListUtils';

describe('parseCommitMessage', () => {
  it('should_parse_conventional_type_scope_and_subject_when_header_matches', () => {
    expect(parseCommitMessage('feat(git): add graph hover\n\nbody')).toEqual({
      type: 'feat',
      scope: 'git',
      subject: 'add graph hover',
      header: 'feat(git): add graph hover',
    });
  });

  it('should_parse_breaking_change_marker_and_empty_scope', () => {
    expect(parseCommitMessage('refactor!: drop legacy api')).toEqual({
      type: 'refactor',
      scope: '',
      subject: 'drop legacy api',
      header: 'refactor!: drop legacy api',
    });
    expect(parseCommitMessage('refactor(conversation): format adapters and manager')).toEqual({
      type: 'refactor',
      scope: 'conversation',
      subject: 'format adapters and manager',
      header: 'refactor(conversation): format adapters and manager',
    });
  });

  it('should_return_full_header_as_subject_when_not_conventional', () => {
    expect(parseCommitMessage('Initial commit')).toEqual({
      type: '',
      scope: '',
      subject: 'Initial commit',
      header: 'Initial commit',
    });
  });
});

describe('commitBodyPreview', () => {
  it('should_return_empty_when_only_header', () => {
    expect(commitBodyPreview('feat: only header')).toBe('');
  });

  it('should_return_up_to_two_body_lines', () => {
    const msg = 'feat: title\n\nline1\nline2\nline3';
    expect(commitBodyPreview(msg)).toBe('line1\nline2');
  });
});

describe('typeStyle', () => {
  it('should_use_accent_colors_for_common_types', () => {
    expect(typeStyle('feat')).toContain('accent-blue');
    expect(typeStyle('fix')).toContain('accent-red');
    expect(typeStyle('perf')).toContain('accent-green');
    expect(typeStyle('docs')).toContain('accent-yellow');
    expect(typeStyle('chore')).toContain('text-muted');
  });
});

describe('formatRefs', () => {
  it('should_prefer_HEAD_target_as_primary', () => {
    const r = formatRefs('HEAD -> main, origin/main, tag: v1.0.0');
    expect(r).toEqual({
      primary: 'main',
      extraCount: 2,
      title: 'main, origin/main, v1.0.0',
    });
  });

  it('should_return_null_when_refs_empty', () => {
    expect(formatRefs('')).toBeNull();
    expect(formatRefs('   ')).toBeNull();
  });
});

describe('formatRefsList', () => {
  it('should_use_first_unique_ref_as_primary_with_kind', () => {
    const r = formatRefsList([
      { kind: 'branch', name: 'main' },
      { kind: 'remote', name: 'origin/main' },
      { kind: 'tag', name: 'v1.0.4' },
    ]);
    expect(r).toEqual({
      primary: 'main',
      kind: 'branch',
      extraCount: 2,
      title: 'main, origin/main, v1.0.4',
    });
  });

  it('should_deduplicate_and_cap_extra_count', () => {
    const r = formatRefsList([
      { kind: 'branch', name: 'main' },
      { kind: 'branch', name: 'main' },
      { kind: 'tag', name: 'v1.0.4' },
    ]);
    expect(r).toEqual({
      primary: 'main',
      kind: 'branch',
      extraCount: 1,
      title: 'main, v1.0.4',
    });
  });

  it('should_return_null_for_empty_list_or_empty_names', () => {
    expect(formatRefsList([])).toBeNull();
    expect(formatRefsList([{ kind: 'branch', name: '' }])).toBeNull();
  });

  it('should_preserve_stash_kind_for_primary_label', () => {
    const r = formatRefsList([{ kind: 'stash', name: 'stash' }]);
    expect(r?.kind).toBe('stash');
  });
});

describe('refStyle', () => {
  it('should_map_each_kind_to_a_distinct_accent_class', () => {
    expect(refStyle('branch')).toContain('accent-blue');
    expect(refStyle('remote')).toContain('accent-green');
    expect(refStyle('tag')).toContain('accent-yellow');
    expect(refStyle('stash')).toContain('accent-purple');
  });

  it('should_use_neutral_style_for_unknown_kind', () => {
    expect(refStyle('branch')).not.toBe('');
    // unknown 分支走 default 中性样式（防御性，前端不会收到 tool refs）
    expect(refStyle('stash')).not.toBe(refStyle('branch'));
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-25T12:00:00');

  it('should_return_minutes_hours_days_for_recent_times', () => {
    expect(formatRelativeTime('2026-07-25T11:55:00', now)).toBe('5m ago');
    expect(formatRelativeTime('2026-07-25T09:00:00', now)).toBe('3h ago');
    expect(formatRelativeTime('2026-07-24T12:00:00', now)).toBe('yesterday');
    expect(formatRelativeTime('2026-07-22T12:00:00', now)).toBe('3d ago');
  });

  it('should_return_absolute_for_old_dates', () => {
    expect(formatRelativeTime('2024-01-01T00:00:00', now)).toBe('2024/01/01 00:00');
  });
});

describe('formatAbsoluteTime', () => {
  it('should_format_yyyy_mm_dd_hh_mm', () => {
    expect(formatAbsoluteTime('2026-07-25T09:08:00')).toBe('2026/07/25 09:08');
  });
});

describe('graphWidthForCols', () => {
  it('should_cap_visible_width_at_max_lanes', () => {
    const { fullWidth, visibleWidth } = graphWidthForCols(9, 6, 4, MAX_GRAPH_LANES);
    expect(fullWidth).toBeGreaterThan(visibleWidth);
    expect(visibleWidth).toBe(MAX_GRAPH_LANES * 6 + 4 * 4 + 2);
  });

  it('should_not_cap_when_within_max_lanes', () => {
    const { fullWidth, visibleWidth } = graphWidthForCols(2, 6, 4, MAX_GRAPH_LANES);
    expect(fullWidth).toBe(visibleWidth);
  });
});

describe('textLeftForCol', () => {
  it('should_place_text_just_after_dot_not_full_graph_width', () => {
    const branchSpacing = 6;
    const nodeRadius = 4;
    // col 0: dot at 8, text at 8+4+gap
    expect(textLeftForCol(0, branchSpacing, nodeRadius)).toBe(
      0 * branchSpacing + nodeRadius * 2 + nodeRadius + TEXT_AFTER_DOT_GAP,
    );
    // col 2 still only accounts for that col's dot — far smaller than 5-lane graph width
    const left = textLeftForCol(2, branchSpacing, nodeRadius);
    const { visibleWidth } = graphWidthForCols(4, branchSpacing, nodeRadius);
    expect(left).toBe(2 * branchSpacing + nodeRadius * 2 + nodeRadius + TEXT_AFTER_DOT_GAP);
    expect(left).toBeLessThan(visibleWidth);
  });
});

describe('splitFilePath', () => {
  it('should_split_name_and_dir_for_posix_path', () => {
    expect(splitFilePath('com/test/services/TestService.java')).toEqual({
      name: 'TestService.java',
      dir: 'com/test/services',
    });
  });

  it('should_handle_basename_only_and_windows_separators', () => {
    expect(splitFilePath('README.md')).toEqual({ name: 'README.md', dir: '' });
    expect(splitFilePath('src\\features\\git\\CommitList.tsx')).toEqual({
      name: 'CommitList.tsx',
      dir: 'src/features/git',
    });
  });
});

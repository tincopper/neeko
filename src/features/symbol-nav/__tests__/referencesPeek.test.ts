// @vitest-environment node
/**
 * referencesPeek 纯函数：引用分组（保序）与预览切片（边界夹紧）。
 * 语言无关：只认 uri + range，不读 languageId。
 */
import { describe, expect, it } from 'vitest';

import type { LspLocation } from '@/features/lsp/types';

import {
  clampPeekTreeWidth,
  groupReferencesByFile,
  slicePreview,
  windowPreviewLines,
} from '../referencesPeek';

function loc(uri: string, line: number, sc: number, ec: number): LspLocation {
  return {
    uri,
    range: { start: { line, character: sc }, end: { line, character: ec } },
  };
}

describe('groupReferencesByFile', () => {
  it('should_group_by_uri_preserving_server_order', () => {
    const groups = groupReferencesByFile([
      loc('file:///proj/b.ts', 1, 0, 3),
      loc('file:///proj/a.ts', 5, 2, 6),
      loc('file:///proj/b.ts', 9, 1, 4),
    ]);
    expect(groups.map((g) => g.uri)).toEqual(['file:///proj/b.ts', 'file:///proj/a.ts']);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items).toHaveLength(1);
    // 原始 range 完整透传（跳转端口需要真实 end，不能被压成 line0/startChar/endChar）
    expect(groups[0].items[0]).toEqual(loc('file:///proj/b.ts', 1, 0, 3));
  });

  it('should_return_empty_for_empty_input', () => {
    expect(groupReferencesByFile([])).toEqual([]);
  });

  it('should_derive_display_path_per_file', () => {
    const groups = groupReferencesByFile([loc('file:///proj/src/a.ts', 0, 0, 1)]);
    expect(groups[0].filePath).toBe('/proj/src/a.ts');
  });
});

describe('clampPeekTreeWidth', () => {
  it('should_clamp_to_min_and_max', () => {
    expect(clampPeekTreeWidth(100)).toBe(220);
    expect(clampPeekTreeWidth(1000)).toBe(600);
    expect(clampPeekTreeWidth(400)).toBe(400);
  });
});

describe('slicePreview', () => {
  const LINES = ['l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9'];

  it('should_take_3_lines_context_each_side', () => {
    const s = slicePreview(LINES, 5);
    expect(s.lines).toEqual(['l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8']);
    expect(s.baseLine0).toBe(2);
    expect(s.matchLineIdx).toBe(3);
  });

  it('should_clamp_at_file_start', () => {
    const s = slicePreview(LINES, 1);
    expect(s.lines).toEqual(['l0', 'l1', 'l2', 'l3', 'l4']);
    expect(s.baseLine0).toBe(0);
    expect(s.matchLineIdx).toBe(1);
  });

  it('should_clamp_at_file_end', () => {
    const s = slicePreview(LINES, 9);
    expect(s.lines).toEqual(['l6', 'l7', 'l8', 'l9']);
    expect(s.baseLine0).toBe(6);
    expect(s.matchLineIdx).toBe(3);
  });

  it('should_clamp_out_of_range_line_to_last', () => {
    const s = slicePreview(['a', 'b', ''], 99);
    expect(s.lines).toEqual(['a', 'b', '']);
    expect(s.matchLineIdx).toBe(s.lines.length - 1);
  });

  it('should_return_full_slice_when_file_shorter_than_window', () => {
    const s = slicePreview(['only'], 0);
    expect(s).toEqual({ lines: ['only'], baseLine0: 0, matchLineIdx: 0 });
  });
});

describe('windowPreviewLines', () => {
  it('should_return_full_file_when_small', () => {
    const all = Array.from({ length: 20 }, (_, i) => `L${i}`);
    const s = windowPreviewLines(all, 15);
    expect(s.lines).toHaveLength(20);
    expect(s.baseLine0).toBe(0);
    expect(s.matchLineIdx).toBe(15);
  });

  it('should_window_huge_files_around_match', () => {
    const all = Array.from({ length: 2500 }, (_, i) => `L${i}`);
    const s = windowPreviewLines(all, 2000);
    expect(s.lines.length).toBeLessThanOrEqual(2001);
    expect(s.lines[s.matchLineIdx]).toBe('L2000');
  });
});

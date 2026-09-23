// @vitest-environment node
/**
 * referencesPeekStore：分组 + 按 uri 去重拉取 + 单文件失败隔离 + 200 截断。
 * loader 经模块 mock 注入（vi.mock definitionTarget），不碰 IPC。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DefinitionTargetContent } from '@/features/lsp/api/definitionTarget';
import { loadDefinitionTargetContent } from '@/features/lsp/api/definitionTarget';
import type { LspLocation } from '@/features/lsp/types';

import {
  PEEK_MAX_ITEMS,
  peekItemAt,
  useReferencesPeekStore,
  type PeekNavigate,
} from '../referencesPeekStore';

vi.mock('@/features/lsp/api/definitionTarget', () => ({
  loadDefinitionTargetContent: vi.fn(),
}));

function loc(uri: string, line: number, sc = 0, ec = 5): LspLocation {
  return { uri, range: { start: { line, character: sc }, end: { line, character: ec } } };
}

function textOf(lines: string[]): string {
  return lines.join('\n');
}

function projectFile(content: string) {
  return {
    kind: 'project-file' as const,
    content: { path: '/p', content, size: content.length, is_binary: false },
  };
}

const navigate = vi.fn<PeekNavigate>(async () => undefined);
const OPTS = { projectId: 'p1', projectPath: '/proj', languageId: 'go', navigate };

/** 扁平条目视图（`groups` 是唯一来源，测试同走派生，不再手工同步双数组）。 */
function items() {
  return useReferencesPeekStore.getState().groups.flatMap((g) => g.items);
}

function viewItem(id: string) {
  return {
    id,
    filePath: `/proj/${id}.go`,
    snippet: '',
    previewLines: [],
    previewBaseLine0: 0,
    previewMatchIdx: 0,
    matchStartChar: 0,
    matchEndChar: 1,
    location: {
      uri: `file:///proj/${id}.go`,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    },
  };
}

function groupOf(uri: string, ids: string[]) {
  return { uri, filePath: uri, items: ids.map(viewItem) };
}

describe('peekItemAt', () => {
  it('should_walk_across_group_boundaries_and_return_undefined_out_of_range', () => {
    const groups = [groupOf('a', ['a0', 'a1']), groupOf('b', ['b0'])];
    expect(peekItemAt(groups, 0)?.id).toBe('a0');
    expect(peekItemAt(groups, 1)?.id).toBe('a1');
    // 跨组边界：上一组耗尽后必须落到下一组首条，且不得返回上一组末条
    expect(peekItemAt(groups, 2)?.id).toBe('b0');
    expect(peekItemAt(groups, 3)).toBeUndefined();
    expect(peekItemAt(groups, -1)).toBeUndefined();
    expect(peekItemAt([], 0)).toBeUndefined();
  });
});

describe('openPeek — 分组与标题', () => {
  beforeEach(() => {
    useReferencesPeekStore.getState().close();
    vi.mocked(loadDefinitionTargetContent).mockReset();
    navigate.mockClear();
  });

  it('should_group_by_file_preserving_order_and_title_with_hint', async () => {
    vi.mocked(loadDefinitionTargetContent).mockResolvedValue(
      projectFile(textOf(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'])),
    );
    useReferencesPeekStore.getState().openPeek({
      ...OPTS,
      locations: [
        loc('file:///proj/b.go', 1),
        loc('file:///proj/a.go', 5),
        loc('file:///proj/b.go', 3),
      ],
      symbolHint: 'myFn',
    });
    await vi.waitFor(() => {
      expect(useReferencesPeekStore.getState().loading).toBe(false);
    });
    const s = useReferencesPeekStore.getState();
    expect(s.groups.map((g) => g.uri)).toEqual(['file:///proj/b.go', 'file:///proj/a.go']);
    expect(items()).toHaveLength(3);
    expect(s.title).toBe('References: myFn (3)');
    expect(s.truncated).toBe(false);
  });

  it('should_split_crlf_content_without_leaving_carriage_returns', async () => {
    vi.mocked(loadDefinitionTargetContent).mockResolvedValue(projectFile('a\r\nb\r\nc'));
    useReferencesPeekStore
      .getState()
      .openPeek({ ...OPTS, locations: [loc('file:///proj/a.go', 1)] });
    await vi.waitFor(() => {
      expect(useReferencesPeekStore.getState().loading).toBe(false);
    });
    expect(items()[0].previewLines).toEqual(['a', 'b', 'c']);
    expect(items()[0].snippet).toBe('b');
  });

  it('should_dedupe_text_fetch_per_uri', async () => {
    vi.mocked(loadDefinitionTargetContent).mockResolvedValue(projectFile('x\n'.repeat(10)));
    useReferencesPeekStore.getState().openPeek({
      ...OPTS,
      locations: [
        loc('file:///proj/a.go', 0),
        loc('file:///proj/a.go', 1),
        loc('file:///proj/b.go', 2),
      ],
    });
    await vi.waitFor(() => {
      expect(useReferencesPeekStore.getState().loading).toBe(false);
    });
    expect(vi.mocked(loadDefinitionTargetContent)).toHaveBeenCalledTimes(2);
  });

  it('should_isolate_single_file_failure', async () => {
    vi.mocked(loadDefinitionTargetContent).mockImplementation(async (_p, _pp, _l, uri: string) => {
      if (uri.endsWith('bad.go')) throw new Error('denied');
      return projectFile(textOf(['k0', 'k1', 'k2', 'k3', 'k4', 'k5']));
    });
    useReferencesPeekStore.getState().openPeek({
      ...OPTS,
      locations: [loc('file:///proj/bad.go', 2), loc('file:///proj/ok.go', 1)],
    });
    await vi.waitFor(() => {
      expect(useReferencesPeekStore.getState().loading).toBe(false);
    });
    expect(items()).toHaveLength(2);
    expect(items()[0].previewLines).toEqual([]);
    expect(items()[0].snippet).toBe('');
    expect(items()[1].snippet).toBe('k1');
  });

  it('should_truncate_at_max_items', async () => {
    vi.mocked(loadDefinitionTargetContent).mockResolvedValue(
      projectFile(textOf(['z0', 'z1', 'z2'])),
    );
    const many = Array.from({ length: PEEK_MAX_ITEMS + 10 }, (_, i) => loc('file:///proj/a.go', i));
    useReferencesPeekStore.getState().openPeek({ ...OPTS, locations: many });
    await vi.waitFor(() => {
      expect(useReferencesPeekStore.getState().loading).toBe(false);
    });
    const s = useReferencesPeekStore.getState();
    expect(items()).toHaveLength(PEEK_MAX_ITEMS);
    expect(s.truncated).toBe(true);
    expect(s.title).toContain(`(${PEEK_MAX_ITEMS + 10})`);
  });

  it('should_preview_full_file_with_match_index', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i}`);
    vi.mocked(loadDefinitionTargetContent).mockResolvedValue(projectFile(textOf(lines)));
    useReferencesPeekStore.getState().openPeek({
      ...OPTS,
      locations: [loc('file:///proj/a.go', 15)],
    });
    await vi.waitFor(() => {
      expect(useReferencesPeekStore.getState().loading).toBe(false);
    });
    const item = items()[0];
    expect(item.previewLines).toHaveLength(20);
    expect(item.previewBaseLine0).toBe(0);
    expect(item.previewMatchIdx).toBe(15);
    expect(item.snippet).toBe('line15');
  });

  it('should_window_huge_files_around_match', async () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `L${i}`);
    vi.mocked(loadDefinitionTargetContent).mockResolvedValue(projectFile(textOf(lines)));
    useReferencesPeekStore.getState().openPeek({
      ...OPTS,
      locations: [loc('file:///proj/big.go', 2000)],
    });
    await vi.waitFor(() => {
      expect(useReferencesPeekStore.getState().loading).toBe(false);
    });
    const item = items()[0];
    expect(item.previewLines.length).toBeLessThanOrEqual(2001);
    expect(item.previewLines[item.previewMatchIdx]).toBe('L2000');
  });

  it('should_abort_when_closed_during_load', async () => {
    const gate = Promise.withResolvers<DefinitionTargetContent>();
    vi.mocked(loadDefinitionTargetContent).mockReturnValue(gate.promise);
    useReferencesPeekStore
      .getState()
      .openPeek({ ...OPTS, locations: [loc('file:///proj/a.go', 0)] });
    expect(useReferencesPeekStore.getState().loading).toBe(true);
    useReferencesPeekStore.getState().close();
    gate.resolve(projectFile('q0\nq1'));
    // 迟到响应落定后仍需多个 microtask 才走完 continuation：用 macrotask 确定性排空。
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const s = useReferencesPeekStore.getState();
    expect(s.open).toBe(false);
    expect(items()).toEqual([]);
  });

  it('should_drop_superseded_batch_when_reopened_before_it_settles', async () => {
    vi.useFakeTimers();
    try {
      const gate = Promise.withResolvers<DefinitionTargetContent>();
      vi.mocked(loadDefinitionTargetContent)
        .mockReturnValueOnce(gate.promise)
        .mockResolvedValue(projectFile('B0\nB1\nB2'));

      // 点 A（挂起）→ 关闭 → 立刻点 B：`open` 始终为 true，故仅凭 open 无法区分批次。
      useReferencesPeekStore
        .getState()
        .openPeek({ ...OPTS, locations: [loc('file:///proj/A.go', 0)], symbolHint: 'A' });
      useReferencesPeekStore.getState().close();
      useReferencesPeekStore
        .getState()
        .openPeek({ ...OPTS, locations: [loc('file:///proj/B.go', 0)], symbolHint: 'B' });

      await vi.advanceTimersByTimeAsync(0); // B 批次落定（无真实等待）
      expect(items().map((i) => i.snippet)).toEqual(['B0']);

      // A 的迟到响应到达：批次号已换代 → 必须整批丢弃，不得覆盖 B。
      gate.resolve(projectFile('A0\nA1\nA2'));
      await vi.advanceTimersByTimeAsync(0);
      const s = useReferencesPeekStore.getState();
      expect(s.title).toBe('References: B (1)');
      expect(s.groups.map((g) => g.uri)).toEqual(['file:///proj/B.go']);
      expect(items().map((i) => i.snippet)).toEqual(['B0']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('openPeek — 选择与确认', () => {
  beforeEach(() => {
    useReferencesPeekStore.getState().close();
    vi.mocked(loadDefinitionTargetContent).mockReset();
    navigate.mockClear();
  });

  async function openTwo() {
    vi.mocked(loadDefinitionTargetContent).mockResolvedValue(
      projectFile(textOf(['m0', 'm1', 'm2', 'm3'])),
    );
    useReferencesPeekStore.getState().openPeek({
      ...OPTS,
      locations: [loc('file:///proj/a.go', 0), loc('file:///proj/b.go', 2)],
    });
    await vi.waitFor(() => {
      expect(useReferencesPeekStore.getState().loading).toBe(false);
    });
  }

  it('should_wrap_selection_and_confirm_opens_file', async () => {
    await openTwo();
    const s0 = useReferencesPeekStore.getState();
    expect(s0.selectedIndex).toBe(0);
    s0.moveSelection(1);
    expect(useReferencesPeekStore.getState().selectedIndex).toBe(1);
    useReferencesPeekStore.getState().moveSelection(1);
    expect(useReferencesPeekStore.getState().selectedIndex).toBe(0);
    await useReferencesPeekStore.getState().confirm();
    // 跳转经注入端口（store 不持有实现）：入参是**原始 location**（uri + 完整 range）
    expect(navigate).toHaveBeenCalledWith(loc('file:///proj/a.go', 0));
    expect(useReferencesPeekStore.getState().open).toBe(false);
  });
});

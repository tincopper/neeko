import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffHunk, DiffResult } from '../types';
import { useDiffReview } from '../useDiffReview';

// ── 外部依赖 mock ──────────────────────────────────────────────────────────
const sendToAgent = vi.hoisted(() => vi.fn());
const clearPending = vi.hoisted(() => vi.fn());

vi.mock('@/shared/hooks/useEditorAgentActions', () => ({
  useEditorAgentActions: () => ({ sendToAgent, clearPending, pending: null }),
}));

// getProjectIdFromTab 读取 editorStore.getState().tabs；传 projectId 时不会触达
vi.mock('@/shared/store/editorStore', () => ({
  useEditorStore: { getState: () => ({ tabs: {} }) },
}));

const addNotification = vi.hoisted(() => vi.fn());

vi.mock('@/shared/store/notificationStore', () => ({
  useNotificationStore: { getState: () => ({ addNotification }) },
}));

// ── fixtures ───────────────────────────────────────────────────────────────
const HUNK: DiffHunk = {
  old_start: 10,
  old_lines: 3,
  new_start: 10,
  new_lines: 3,
  lines: [{ Context: 'keep' }, { Removed: 'gone' }, { Added: 'added' }],
};

const DIFF_RESULT: DiffResult = { hunks: [HUNK] };

function file(path: string): CommitFileChange {
  return { path, status: 'M', additions: 1, deletions: 0 };
}

/** combined 选区 key：`path\0hunk:line`（\0 为合法 NUL 转义，避免 legacy octal）。 */
function selectionKey(path: string, local: string): string {
  return `${path}\0${local}`;
}

interface RenderReviewOverrides {
  projectId?: string;
  combined?: boolean;
  filePath?: string;
  diffResult?: DiffResult | null;
  fileList?: CommitFileChange[];
  selectedLines?: Set<string>;
  clearSelection?: () => void;
}

function renderReview(overrides: RenderReviewOverrides = {}) {
  const clearSelection = vi.fn();
  return renderHook((props: Parameters<typeof useDiffReview>[0]) => useDiffReview(props), {
    initialProps: {
      projectId: 'p1',
      combined: false,
      filePath: 'src/a.ts',
      diffResult: DIFF_RESULT,
      fileList: [],
      selectedLines: new Set<string>(),
      clearSelection,
      ...overrides,
    },
  });
}

describe('useDiffReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendToAgent.mockReturnValue(true);
  });

  // ── 弹层状态 ────────────────────────────────────────────────────────────
  it('should_open_and_close_review_popover', () => {
    const { result } = renderReview();

    expect(result.current.reviewPopover).toBe(false);
    act(() => {
      result.current.handleReviewFull();
    });
    expect(result.current.reviewPopover).toBe(true);
    act(() => {
      result.current.setReviewPopover(false);
    });
    expect(result.current.reviewPopover).toBe(false);
  });

  // ── 派生 state：single 模式 ──────────────────────────────────────────────
  it('should_derive_selection_state_in_single_mode', () => {
    const { result } = renderReview({ selectedLines: new Set(['0:1', '1:0']) });

    expect(result.current.selectedCount).toBe(2);
    // single 模式 key 无路径前缀 → lastSelectedPath 为 null
    expect(result.current.lastSelectedPath).toBeNull();
    expect(result.current.selectedLinesForPath('src/a.ts')).toEqual(new Set());
  });

  // ── 派生 state：combined 模式 ────────────────────────────────────────────
  it('should_derive_per_file_selection_and_last_selected_path_in_combined_mode', () => {
    const { result } = renderReview({
      combined: true,
      fileList: [file('src/a.ts'), file('src/b.ts')],
      selectedLines: new Set([
        selectionKey('src/a.ts', '0:1'),
        selectionKey('src/a.ts', '0:2'),
        selectionKey('src/b.ts', '1:0'),
      ]),
    });

    expect(result.current.selectedCount).toBe(3);
    expect(result.current.selectedLinesForPath('src/a.ts')).toEqual(new Set(['0:1', '0:2']));
    // hunk 1 > hunk 0 → 全局最后选中行在 src/b.ts
    expect(result.current.lastSelectedPath).toBe('src/b.ts');
  });

  // ── 提交选区 review（single）────────────────────────────────────────────
  it('should_submit_selection_review_in_single_mode', () => {
    const clearSelection = vi.fn();
    const { result } = renderReview({
      selectedLines: new Set(['0:2']),
      clearSelection,
    });

    act(() => {
      result.current.submitSelectionReview();
    });

    expect(sendToAgent).toHaveBeenCalledTimes(1);
    const [projectId, message] = sendToAgent.mock.calls[0];
    expect(projectId).toBe('p1');
    expect(message).toContain('review the selected changes in src/a.ts');
    expect(message).toContain('Diff:');
    // 选中行（Added 行：Removed 不占 new 行号 → new-side 行号为 11）拼入 diff 文本
    expect(message).toContain('-|11| added');
    // 成功提交 → 清空选区
    expect(clearSelection).toHaveBeenCalledTimes(1);
  });

  // ── 提交选区 review（combined）──────────────────────────────────────────
  it('should_submit_selection_review_in_combined_mode_with_reported_hunks', () => {
    const { result } = renderReview({
      combined: true,
      fileList: [file('src/a.ts')],
      selectedLines: new Set([selectionKey('src/a.ts', '0:2')]),
    });

    // FileDiffSection 上报渲染 hunks
    act(() => {
      result.current.reportDiffResult('src/a.ts', DIFF_RESULT.hunks);
    });
    act(() => {
      result.current.submitSelectionReview('focus on edge cases');
    });

    const message = sendToAgent.mock.calls[0][1] as string;
    expect(message).toContain('review the selected changes across');
    expect(message).toContain('## file: src/a.ts');
    expect(message).toContain('Custom instruction (highest priority):\nfocus on edge cases');
  });

  // ── 提交全文 review ──────────────────────────────────────────────────────
  it('should_submit_full_review_with_instruction_and_close_popover', () => {
    const { result } = renderReview();

    act(() => {
      result.current.handleReviewFull();
    });
    expect(result.current.reviewPopover).toBe(true);

    act(() => {
      result.current.submitFullReview('check naming');
    });

    const message = sendToAgent.mock.calls[0][1] as string;
    expect(message).toContain('review the changes in src/a.ts');
    expect(message).toContain('Custom instruction (highest priority):\ncheck naming');
    expect(message).toContain('Diff:');
    // 提交后弹层关闭
    expect(result.current.reviewPopover).toBe(false);
  });

  // ── 无 agent 终端 → 通知 + 保留 pending ─────────────────────────────────
  it('should_notify_and_keep_selection_when_no_agent_terminal', () => {
    sendToAgent.mockReturnValue(false);
    const clearSelection = vi.fn();
    const { result } = renderReview({ clearSelection });

    act(() => {
      result.current.submitFullReview();
    });

    expect(sendToAgent).toHaveBeenCalledTimes(1);
    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning', title: 'No agent terminal open' }),
    );
    expect(clearPending).toHaveBeenCalledTimes(1);
    expect(clearSelection).not.toHaveBeenCalled();
  });

  // ── 数据提升缓存 ─────────────────────────────────────────────────────────
  it('should_clear_hunks_cache', () => {
    const { result } = renderReview({ combined: true, fileList: [file('src/a.ts')] });

    act(() => {
      result.current.reportDiffResult('src/a.ts', DIFF_RESULT.hunks);
    });
    act(() => {
      result.current.clearHunksCache();
    });
    act(() => {
      result.current.submitFullReview();
    });

    const message = sendToAgent.mock.calls[0][1] as string;
    // 缓存清空 → combined 全文 review 无文件段（只有标题，无 diff 段）
    expect(message).toContain('review this commit diff across 1 files');
    expect(message).not.toContain('## file:');
  });
});

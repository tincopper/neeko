import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileChangedEvent } from '@/shared/types';
import type { ProjectCommands } from '@/shared/types/project';

import type { DiffResult } from '../types';
import { useDiffData } from '../useDiffData';

// 捕获 useFileChangedEvent 注册的回调（模拟其共享订阅的 Set 去重语义）
const { fileChangedCallbacks } = vi.hoisted(() => ({
  fileChangedCallbacks: [] as Array<(ev: FileChangedEvent) => void>,
}));

vi.mock('@/shared/hooks/useFileChangedEvent', () => ({
  useFileChangedEvent: (cb: (ev: FileChangedEvent) => void) => {
    if (!fileChangedCallbacks.includes(cb)) fileChangedCallbacks.push(cb);
  },
}));

// 捕获 useGitRefresh 注册的回调（Git 面板刷新信号）
const { gitRefreshCallbacks } = vi.hoisted(() => ({
  gitRefreshCallbacks: [] as Array<(projectId: string) => void>,
}));

vi.mock('@/shared/hooks/useGitRefresh', () => ({
  useGitRefresh: (cb: (projectId: string) => void) => {
    if (!gitRefreshCallbacks.includes(cb)) gitRefreshCallbacks.push(cb);
  },
}));

const getFileDiff = vi.hoisted(() => vi.fn());

const commands = {
  getFileDiff,
} as unknown as ProjectCommands;

function makeDiff(content: string): DiffResult {
  return {
    hunks: [
      {
        old_start: 1,
        old_lines: 1,
        new_start: 1,
        new_lines: 1,
        lines: [{ Context: content }],
      },
    ],
  };
}

// 稳定的 diffSource 引用（避免每次 render 生成新 key）
const DIFF_SOURCE = { type: 'local', projectId: 'p1' } as const;

describe('useDiffData file-changed refresh', () => {
  beforeEach(() => {
    fileChangedCallbacks.length = 0;
    gitRefreshCallbacks.length = 0;
    getFileDiff.mockReset();
  });

  it('reloads diff content when the file changes on disk', async () => {
    getFileDiff.mockResolvedValueOnce(makeDiff('old-content'));
    const { result } = renderHook(() =>
      useDiffData({
        projectId: 'p1',
        diffSource: DIFF_SOURCE,
        filePath: 'src/a.ts',
        commands,
      }),
    );

    await waitFor(() =>
      expect(result.current.diffResult?.hunks[0].lines[0].Context).toBe('old-content'),
    );
    expect(getFileDiff).toHaveBeenCalledTimes(1);

    // 文件内容变更事件 → 应重新请求并展示新内容
    getFileDiff.mockResolvedValueOnce(makeDiff('new-content'));
    act(() => {
      for (const cb of fileChangedCallbacks) {
        cb({ project_id: 'p1', paths: ['src/a.ts'] });
      }
    });

    await waitFor(() =>
      expect(result.current.diffResult?.hunks[0].lines[0].Context).toBe('new-content'),
    );
    expect(getFileDiff).toHaveBeenCalledTimes(2);
  });

  it('ignores file-changed events for other files', async () => {
    getFileDiff.mockResolvedValueOnce(makeDiff('old-content'));
    const { result } = renderHook(() =>
      useDiffData({
        projectId: 'p1',
        diffSource: DIFF_SOURCE,
        filePath: 'src/b.ts',
        commands,
      }),
    );
    await waitFor(() =>
      expect(result.current.diffResult?.hunks[0].lines[0].Context).toBe('old-content'),
    );
    expect(getFileDiff).toHaveBeenCalledTimes(1);

    // 其他文件变更 → 不应重新请求
    act(() => {
      for (const cb of fileChangedCallbacks) {
        cb({ project_id: 'p1', paths: ['src/other.ts'] });
      }
    });

    // 给潜在的错误刷新留出微任务窗口，再断言没有新增请求
    await new Promise((r) => setTimeout(r, 20));
    expect(getFileDiff).toHaveBeenCalledTimes(1);
    expect(result.current.diffResult?.hunks[0].lines[0].Context).toBe('old-content');
  });

  it('reloads diff when the Git panel refresh button fires', async () => {
    getFileDiff.mockResolvedValueOnce(makeDiff('old-content'));
    const { result } = renderHook(() =>
      useDiffData({
        projectId: 'p1',
        diffSource: DIFF_SOURCE,
        filePath: 'src/c.ts',
        commands,
      }),
    );

    await waitFor(() =>
      expect(result.current.diffResult?.hunks[0].lines[0].Context).toBe('old-content'),
    );
    expect(getFileDiff).toHaveBeenCalledTimes(1);

    // Git 面板刷新按钮 → 该项目应绕过缓存重新请求
    getFileDiff.mockResolvedValueOnce(makeDiff('new-content'));
    act(() => {
      for (const cb of gitRefreshCallbacks) {
        cb('p1');
      }
    });

    await waitFor(() =>
      expect(result.current.diffResult?.hunks[0].lines[0].Context).toBe('new-content'),
    );
    expect(getFileDiff).toHaveBeenCalledTimes(2);
  });

  it('ignores Git refresh signals for other projects', async () => {
    getFileDiff.mockResolvedValueOnce(makeDiff('old-content'));
    const { result } = renderHook(() =>
      useDiffData({
        projectId: 'p1',
        diffSource: DIFF_SOURCE,
        filePath: 'src/d.ts',
        commands,
      }),
    );

    await waitFor(() =>
      expect(result.current.diffResult?.hunks[0].lines[0].Context).toBe('old-content'),
    );
    expect(getFileDiff).toHaveBeenCalledTimes(1);

    // 其他项目刷新 → 不应重新请求
    act(() => {
      for (const cb of gitRefreshCallbacks) {
        cb('p2');
      }
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(getFileDiff).toHaveBeenCalledTimes(1);
    expect(result.current.diffResult?.hunks[0].lines[0].Context).toBe('old-content');
  });
});

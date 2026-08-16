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

// 捕获 git-status-diff（Tauri listen）注册的回调（仓库级自动刷新主信号）
const { mockListen, statusDiffListeners } = vi.hoisted(() => {
  const statusDiffListeners: Array<(event: { payload: { project_id: string } }) => void> = [];
  const mockListen = (
    eventName: string,
    cb: (event: { payload: { project_id: string } }) => void,
  ) => {
    if (eventName === 'git-status-diff') statusDiffListeners.push(cb);
    return Promise.resolve(() => {});
  };
  return { mockListen, statusDiffListeners };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...(args as Parameters<typeof mockListen>)),
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

describe('useDiffData refresh signals', () => {
  beforeEach(() => {
    fileChangedCallbacks.length = 0;
    gitRefreshCallbacks.length = 0;
    statusDiffListeners.length = 0;
    getFileDiff.mockReset();
  });

  it('reloads with collapse=false when full content is requested', async () => {
    getFileDiff.mockResolvedValueOnce(makeDiff('full-content'));
    const { result } = renderHook(() =>
      useDiffData({
        projectId: 'p1',
        diffSource: DIFF_SOURCE,
        filePath: 'src/a.ts',
        commands,
        collapse: false,
      }),
    );
    await waitFor(() =>
      expect(result.current.diffResult?.hunks[0].lines[0].Context).toBe('full-content'),
    );
    // collapse=false 应透传给后端命令
    expect(getFileDiff).toHaveBeenCalledWith('src/a.ts', false);
  });

  it('loads stash file diff via commands.getStashFileDiff', async () => {
    const getStashFileDiff = vi.fn().mockResolvedValue(makeDiff('stash-content'));
    const stashCommands = { getStashFileDiff } as unknown as ProjectCommands;
    const { result } = renderHook(() =>
      useDiffData({
        projectId: 'p1',
        diffSource: { type: 'stash', projectId: 'p1', selector: 'stash@{0}' },
        filePath: 'src/a.ts',
        commands: stashCommands,
      }),
    );
    await waitFor(() =>
      expect(result.current.diffResult?.hunks[0].lines[0].Context).toBe('stash-content'),
    );
    // stash diff 应走 getStashFileDiff（selector + filePath + collapse 透传）
    expect(getStashFileDiff).toHaveBeenCalledWith('stash@{0}', 'src/a.ts', true);
  });

  it('reloads when collapse changes', async () => {
    // 独立文件路径，避免与其它用例互相干扰
    const filePath = 'src/collapse-toggle.ts';
    getFileDiff.mockResolvedValueOnce(makeDiff('collapsed'));
    const { result, rerender } = renderHook(
      ({ collapse }: { collapse?: boolean }) =>
        useDiffData({
          projectId: 'p1',
          diffSource: DIFF_SOURCE,
          filePath,
          commands,
          collapse,
        }),
      { initialProps: { collapse: true } },
    );
    await waitFor(() =>
      expect(result.current.diffResult?.hunks[0].lines[0].Context).toBe('collapsed'),
    );

    // 切到全量（collapse=false）：应重新请求
    getFileDiff.mockResolvedValueOnce(makeDiff('full'));
    rerender({ collapse: false });
    await waitFor(() => expect(result.current.diffResult?.hunks[0].lines[0].Context).toBe('full'));
    expect(getFileDiff).toHaveBeenCalledTimes(2);
    expect(getFileDiff).toHaveBeenLastCalledWith(filePath, false);
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

    // Git 面板刷新按钮 → 该项目应重新请求
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

describe('useDiffData stateless (no module cache)', () => {
  beforeEach(() => {
    fileChangedCallbacks.length = 0;
    gitRefreshCallbacks.length = 0;
    statusDiffListeners.length = 0;
    getFileDiff.mockReset();
  });

  it('refetches on remount even when the same file was loaded before (no stale cache)', async () => {
    const filePath = 'src/remount.ts';

    // 第一次挂载：正常拉取
    getFileDiff.mockResolvedValueOnce(makeDiff('first'));
    const first = renderHook(() =>
      useDiffData({
        projectId: 'p1',
        diffSource: DIFF_SOURCE,
        filePath,
        commands,
      }),
    );
    await waitFor(() =>
      expect(first.result.current.diffResult?.hunks[0].lines[0].Context).toBe('first'),
    );
    first.unmount();
    expect(getFileDiff).toHaveBeenCalledTimes(1);

    // 重新挂载同一文件：无跨挂载缓存 → 必须重新请求（回归：旧实现盲信模块级缓存）
    getFileDiff.mockResolvedValueOnce(makeDiff('fresh'));
    const second = renderHook(() =>
      useDiffData({
        projectId: 'p1',
        diffSource: DIFF_SOURCE,
        filePath,
        commands,
      }),
    );
    await waitFor(() =>
      expect(second.result.current.diffResult?.hunks[0].lines[0].Context).toBe('fresh'),
    );
    expect(getFileDiff).toHaveBeenCalledTimes(2);
    second.unmount();
  });

  it('reloads diff when git-status-diff fires for this project', async () => {
    getFileDiff.mockResolvedValueOnce(makeDiff('old-content'));
    const { result } = renderHook(() =>
      useDiffData({
        projectId: 'p1',
        diffSource: DIFF_SOURCE,
        filePath: 'src/git-status.ts',
        commands,
      }),
    );

    await waitFor(() =>
      expect(result.current.diffResult?.hunks[0].lines[0].Context).toBe('old-content'),
    );
    expect(getFileDiff).toHaveBeenCalledTimes(1);

    // 仓库状态事件（路径无关）→ 应重新请求该文件 diff
    getFileDiff.mockResolvedValueOnce(makeDiff('status-refreshed'));
    act(() => {
      for (const cb of statusDiffListeners) {
        cb({ payload: { project_id: 'p1' } });
      }
    });

    await waitFor(() =>
      expect(result.current.diffResult?.hunks[0].lines[0].Context).toBe('status-refreshed'),
    );
    expect(getFileDiff).toHaveBeenCalledTimes(2);
  });

  it('ignores git-status-diff events for other projects', async () => {
    getFileDiff.mockResolvedValueOnce(makeDiff('old-content'));
    const { result } = renderHook(() =>
      useDiffData({
        projectId: 'p1',
        diffSource: DIFF_SOURCE,
        filePath: 'src/other-status.ts',
        commands,
      }),
    );

    await waitFor(() =>
      expect(result.current.diffResult?.hunks[0].lines[0].Context).toBe('old-content'),
    );
    expect(getFileDiff).toHaveBeenCalledTimes(1);

    // 其他项目的仓库状态事件 → 不应重新请求
    act(() => {
      for (const cb of statusDiffListeners) {
        cb({ payload: { project_id: 'p2' } });
      }
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(getFileDiff).toHaveBeenCalledTimes(1);
    expect(result.current.diffResult?.hunks[0].lines[0].Context).toBe('old-content');
  });
});

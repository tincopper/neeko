import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileChangedEvent } from '@/shared/types';
import type { ProjectCommands } from '@/shared/types/project';

import type { DiffResult } from '../types';
import { DIFF_CACHE_MAX, diffCache, setDiffCache, useDiffData } from '../useDiffData';

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

  it('isolates cache entries by collapse flag', async () => {
    // 独立文件路径，避免与上一条用例共享模块级 diffCache
    const filePath = 'src/cache-isolation.ts';
    // 先加载折叠版（collapse 默认 true）
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

    // 切到全量（collapse=false）：缓存 key 不同 → 应重新请求
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

describe('diffCache 容量上限与淘汰', () => {
  beforeEach(() => {
    diffCache.clear();
  });

  it('超过容量时淘汰最旧条目', () => {
    for (let i = 0; i < DIFF_CACHE_MAX; i++) {
      setDiffCache(`k${i}`, makeDiff(`v${i}`));
    }
    expect(diffCache.size).toBe(DIFF_CACHE_MAX);
    expect(diffCache.has('k0')).toBe(true);

    // 再写一条 → 最旧的 k0 被淘汰
    setDiffCache('k-new', makeDiff('new'));
    expect(diffCache.size).toBe(DIFF_CACHE_MAX);
    expect(diffCache.has('k0')).toBe(false);
    expect(diffCache.has('k-new')).toBe(true);
    expect(diffCache.has('k1')).toBe(true);
  });

  it('更新已有 key 不触发淘汰', () => {
    for (let i = 0; i < DIFF_CACHE_MAX; i++) {
      setDiffCache(`k${i}`, makeDiff(`v${i}`));
    }
    // 更新已有 key：仅覆盖，容量不变
    setDiffCache('k0', makeDiff('v0-updated'));
    expect(diffCache.size).toBe(DIFF_CACHE_MAX);
    expect(diffCache.get('k0')?.hunks[0].lines[0].Context).toBe('v0-updated');
  });
});

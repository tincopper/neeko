import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { StashActionResult } from '@/features/git/types';
import type { ProjectCommands } from '@/shared/types/activeProject';

import { useStashList } from '../useStashList';

function createCommands(overrides?: Partial<ProjectCommands>): ProjectCommands {
  return {
    getStashList: vi.fn().mockResolvedValue([]),
    getStashFiles: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as ProjectCommands;
}

describe('useStashList', () => {
  it('should_load_stashes_on_mount', async () => {
    const getStashList = vi.fn().mockResolvedValue([
      {
        selector: 'stash@{0}',
        hash: 'abc123',
        message: 'On main: wip stash',
        branch: 'main',
        timestamp: '2026-08-14T10:00:00',
      },
    ]);
    const commands = createCommands({ getStashList });

    const { result } = renderHook(() => useStashList(commands));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getStashList).toHaveBeenCalledTimes(1);
    expect(result.current.stashes).toHaveLength(1);
    expect(result.current.stashes[0].selector).toBe('stash@{0}');
  });

  it('should_ignore_when_commands_is_null', async () => {
    const { result } = renderHook(() => useStashList(null));
    expect(result.current.stashes).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('should_reload_and_clear_stashes_when_commands_change', async () => {
    const firstGetStashList = vi.fn().mockResolvedValue([
      {
        selector: 'stash@{0}',
        hash: 'aaa',
        message: 'On main: first stash',
        branch: 'main',
        timestamp: '2026-08-14T10:00:00',
      },
    ]);
    let resolveSecond: ((value: unknown) => void) | undefined;
    const secondGetStashList = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
    );
    const firstCommands = createCommands({ getStashList: firstGetStashList });
    const secondCommands = createCommands({ getStashList: secondGetStashList });

    const { result, rerender } = renderHook(
      ({ commands }: { commands: ProjectCommands | null }) => useStashList(commands),
      { initialProps: { commands: firstCommands } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(firstGetStashList).toHaveBeenCalledTimes(1);
    expect(result.current.stashes).toHaveLength(1);

    // 切换 commands：旧数据应被清空（避免显示上一个项目的 stash），并触发重新加载
    rerender({ commands: secondCommands });
    expect(secondGetStashList).toHaveBeenCalledTimes(1);
    expect(result.current.stashes).toEqual([]);

    await act(async () => {
      resolveSecond?.([
        {
          selector: 'stash@{0}',
          hash: 'bbb',
          message: 'On main: second stash',
          branch: 'main',
          timestamp: '2026-08-14T10:00:00',
        },
      ]);
    });
    expect(result.current.stashes[0].hash).toBe('bbb');
  });

  it('should_discard_stale_load_response_when_commands_change', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    const firstGetStashList = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const secondGetStashList = vi.fn().mockResolvedValue([
      {
        selector: 'stash@{0}',
        hash: 'bbb',
        message: 'On main: second stash',
        branch: 'main',
        timestamp: '2026-08-14T10:00:00',
      },
    ]);
    const firstCommands = createCommands({ getStashList: firstGetStashList });
    const secondCommands = createCommands({ getStashList: secondGetStashList });

    const { result, rerender } = renderHook(
      ({ commands }: { commands: ProjectCommands | null }) => useStashList(commands),
      { initialProps: { commands: firstCommands } },
    );
    // 第一个项目的加载请求挂起
    expect(firstGetStashList).toHaveBeenCalledTimes(1);

    // 切换 commands：第二个请求立即返回
    rerender({ commands: secondCommands });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stashes[0].hash).toBe('bbb');

    // 第一个项目的慢响应晚到，不得覆盖新项目数据
    await act(async () => {
      resolveFirst?.([
        {
          selector: 'stash@{0}',
          hash: 'aaa',
          message: 'On main: first stash',
          branch: 'main',
          timestamp: '2026-08-14T10:00:00',
        },
      ]);
    });
    expect(result.current.stashes[0].hash).toBe('bbb');
  });

  it('should_toggle_expand_and_load_files', async () => {
    const getStashList = vi.fn().mockResolvedValue([
      {
        selector: 'stash@{0}',
        hash: 'abc123',
        message: 'On main: wip stash',
        branch: 'main',
        timestamp: '2026-08-14T10:00:00',
      },
    ]);
    const getStashFiles = vi
      .fn()
      .mockResolvedValue([{ path: 'README.md', status: 'M', additions: 1, deletions: 1 }]);
    const commands = createCommands({ getStashList, getStashFiles });

    const { result } = renderHook(() => useStashList(commands));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleExpand('stash@{0}');
    });

    expect(getStashFiles).toHaveBeenCalledWith('stash@{0}');
    expect(result.current.expandedSelector).toBe('stash@{0}');
    expect(result.current.expandedFiles).toHaveLength(1);
    expect(result.current.expandedFiles[0].path).toBe('README.md');

    // 再次点击收起
    await act(async () => {
      await result.current.toggleExpand('stash@{0}');
    });
    expect(result.current.expandedSelector).toBeNull();
    expect(result.current.expandedFiles).toEqual([]);
  });

  it('should_surface_load_error', async () => {
    const getStashList = vi.fn().mockRejectedValue('stash load failed');
    const commands = createCommands({ getStashList });

    const { result } = renderHook(() => useStashList(commands));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('stash load failed');
  });

  it('should_surface_files_error_but_keep_expanded_selector', async () => {
    const getStashList = vi.fn().mockResolvedValue([
      {
        selector: 'stash@{0}',
        hash: 'abc123',
        message: 'On main: wip stash',
        branch: 'main',
        timestamp: '2026-08-14T10:00:00',
      },
    ]);
    const getStashFiles = vi.fn().mockRejectedValue('stash files failed');
    const commands = createCommands({ getStashList, getStashFiles });

    const { result } = renderHook(() => useStashList(commands));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleExpand('stash@{0}');
    });

    expect(result.current.expandedSelector).toBe('stash@{0}');
    expect(result.current.filesError).toBe('stash files failed');
    expect(result.current.expandedFiles).toEqual([]);
  });

  it('should_discard_stale_expand_response', async () => {
    const getStashList = vi.fn().mockResolvedValue([
      {
        selector: 'stash@{0}',
        hash: 'aaa',
        message: 'On main: a',
        branch: 'main',
        timestamp: '2026-08-14T10:00:00',
      },
      {
        selector: 'stash@{1}',
        hash: 'bbb',
        message: 'On main: b',
        branch: 'main',
        timestamp: '2026-08-14T10:00:00',
      },
    ]);
    let resolveFirst: ((value: unknown) => void) | undefined;
    const getStashFiles = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce([{ path: 'B.ts', status: 'M', additions: 1, deletions: 0 }]);
    const commands = createCommands({ getStashList, getStashFiles });

    const { result } = renderHook(() => useStashList(commands));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 展开 stash@{0}：慢请求挂起
    let firstExpand: Promise<void> = Promise.resolve();
    act(() => {
      firstExpand = result.current.toggleExpand('stash@{0}');
    });
    // 快速展开 stash@{1}：快请求先返回
    await act(async () => {
      await result.current.toggleExpand('stash@{1}');
    });
    expect(result.current.expandedFiles[0].path).toBe('B.ts');

    // stash@{0} 的过期响应到达，不得覆盖 stash@{1} 的文件
    await act(async () => {
      resolveFirst?.([{ path: 'A.ts', status: 'M', additions: 1, deletions: 0 }]);
      await firstExpand;
    });
    expect(result.current.expandedSelector).toBe('stash@{1}');
    expect(result.current.expandedFiles[0].path).toBe('B.ts');
  });

  it('should_not_expose_load_stashes', async () => {
    const commands = createCommands();
    const { result } = renderHook(() => useStashList(commands));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect('loadStashes' in result.current).toBe(false);
  });

  // --- apply / pop ---

  it('should_apply_stash_and_report_result', async () => {
    const stashApply = vi.fn().mockResolvedValue({ success: true, message: '' });
    const commands = createCommands({ stashApply });

    const { result } = renderHook(() => useStashList(commands));

    let outcome: StashActionResult | null = null;
    await act(async () => {
      outcome = await result.current.applyStash('stash@{0}');
    });
    expect(stashApply).toHaveBeenCalledWith('stash@{0}');
    expect(outcome?.success).toBe(true);
    expect(result.current.actionLoading).toBe(false);
  });

  it('should_pop_stash_and_refresh_list', async () => {
    const getStashList = vi.fn().mockResolvedValue([
      {
        selector: 'stash@{0}',
        hash: 'abc123',
        message: 'On main: wip stash',
        branch: 'main',
        timestamp: '2026-08-14T10:00:00',
      },
    ]);
    const stashPop = vi.fn().mockResolvedValue({ success: true, message: '' });
    const commands = createCommands({ getStashList, stashPop });

    const { result } = renderHook(() => useStashList(commands));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getStashList).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.popStash('stash@{0}');
    });
    expect(stashPop).toHaveBeenCalledWith('stash@{0}');
    // pop 成功后刷新列表（条目被移除）
    await waitFor(() => expect(getStashList).toHaveBeenCalledTimes(2));
  });

  it('should_guard_concurrent_actions', async () => {
    let resolveApply: ((value: unknown) => void) | undefined;
    const stashApply = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApply = resolve;
        }),
    );
    const commands = createCommands({ stashApply });

    const { result } = renderHook(() => useStashList(commands));

    let first: Promise<StashActionResult | null> = Promise.resolve(null);
    act(() => {
      first = result.current.applyStash('stash@{0}');
    });
    expect(result.current.actionLoading).toBe(true);

    // 并发操作被守卫拒绝
    let second: StashActionResult | null = null;
    await act(async () => {
      second = await result.current.applyStash('stash@{1}');
    });
    expect(second).toBeNull();
    expect(stashApply).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveApply?.({ success: true, message: '' });
      await first;
    });
    expect(result.current.actionLoading).toBe(false);
  });

  it('should_surface_action_failure_without_throwing', async () => {
    const stashPop = vi.fn().mockResolvedValue({ success: false, message: 'conflict' });
    const commands = createCommands({ stashPop });

    const { result } = renderHook(() => useStashList(commands));
    let outcome: StashActionResult | null = null;
    await act(async () => {
      outcome = await result.current.popStash('stash@{0}');
    });
    expect(outcome?.success).toBe(false);
    expect(outcome?.message).toBe('conflict');
    expect(result.current.actionLoading).toBe(false);
  });
});

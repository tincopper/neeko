import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CommitEntry, ProjectCommands } from '@/shared/types';

import { useGitLog } from '../useGitLog';

function makeCommit(hash: string): CommitEntry {
  return {
    hash,
    short_hash: hash.slice(0, 7),
    author: 'a',
    timestamp: 't',
    message: `commit ${hash}`,
    refs: '',
    parents: [],
  };
}

function createCommands(commits: CommitEntry[] = [makeCommit('aaa'), makeCommit('bbb')]) {
  const getCommitLog = vi.fn().mockResolvedValue(commits);
  return {
    commands: { getCommitLog } as unknown as ProjectCommands,
    getCommitLog,
  };
}

describe('useGitLog enabled gating', () => {
  it('should_not_fetch_when_disabled', async () => {
    const { commands, getCommitLog } = createCommands();
    renderHook(() => useGitLog(commands, false));

    await new Promise((r) => setTimeout(r, 20));
    expect(getCommitLog).not.toHaveBeenCalled();
  });

  it('should_fetch_when_enabled_flips_true', async () => {
    const { commands, getCommitLog } = createCommands();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useGitLog(commands, enabled),
      { initialProps: { enabled: false } },
    );

    expect(getCommitLog).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getCommitLog).toHaveBeenCalledTimes(1);
    expect(result.current.commits).toHaveLength(2);
    expect(result.current.hasMore).toBe(false);
  });

  it('should_keep_data_when_disabled_after_load', async () => {
    const { commands, getCommitLog } = createCommands();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useGitLog(commands, enabled),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.commits).toHaveLength(2));

    rerender({ enabled: false });
    expect(result.current.commits).toHaveLength(2);
    expect(getCommitLog).toHaveBeenCalledTimes(1);
  });

  it('should_defer_refresh_while_disabled_and_reload_after_enabled', async () => {
    const { commands, getCommitLog } = createCommands();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useGitLog(commands, enabled),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.commits).toHaveLength(2));

    rerender({ enabled: false });
    act(() => {
      result.current.refresh();
    });
    // 未激活：不发请求，只复位加载标记
    expect(getCommitLog).toHaveBeenCalledTimes(1);

    rerender({ enabled: true });
    await waitFor(() => expect(getCommitLog).toHaveBeenCalledTimes(2));
    expect(result.current.commits).toHaveLength(2);
  });

  it('should_refresh_immediately_when_enabled', async () => {
    const { commands, getCommitLog } = createCommands();
    const { result } = renderHook(() => useGitLog(commands, true));
    await waitFor(() => expect(result.current.commits).toHaveLength(2));

    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(getCommitLog).toHaveBeenCalledTimes(2));
  });

  it('should_load_once_per_enable_cycle', async () => {
    const { commands, getCommitLog } = createCommands();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useGitLog(commands, enabled),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.commits).toHaveLength(2));

    // 同一次 enabled 期间不重复加载
    rerender({ enabled: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(getCommitLog).toHaveBeenCalledTimes(1);
    expect(result.current.commits).toHaveLength(2);
  });

  it('should_reload_and_clear_data_when_commands_switch', async () => {
    const first = createCommands([makeCommit('aaa'), makeCommit('bbb')]);
    const second = createCommands([makeCommit('ccc')]);
    const { result, rerender } = renderHook(
      ({ commands }: { commands: ProjectCommands }) => useGitLog(commands, true),
      { initialProps: { commands: first.commands } },
    );
    await waitFor(() => expect(result.current.commits).toHaveLength(2));
    expect(first.getCommitLog).toHaveBeenCalledTimes(1);

    // 切换 commands（切项目）：复位标记并自动重新加载新项目，旧数据被清空
    rerender({ commands: second.commands });
    await waitFor(() => expect(second.getCommitLog).toHaveBeenCalled());
    expect(second.getCommitLog).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.commits).toHaveLength(1));
    expect(result.current.commits[0]?.hash).toBe('ccc');
  });
});

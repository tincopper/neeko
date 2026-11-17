import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTeamSnapshot, createTeam } from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import { __resetTeamGenerationForTests, useTeamStore } from '../../store/teamStore';
import { useTeamDelete } from '../useTeamDelete';

/**
 * 删除团队的执行面（`team_delete`）。
 *
 * 三条判据，每条对应一个「不做就会静默坏掉」的后果：
 *
 * 1. **成功且删的是当前打开的队 ⇒ 清 store**。否则下一次脉冲会去 `team_snapshot` 一个
 *    不存在的 id —— 那是「删成功了，界面反而挂了」。
 * 2. **成功但删的不是当前队 ⇒ 不清 store**。否则一次无关的清理动作变成了视角重置。
 * 3. **失败 ⇒ 不清 store，并原样显示后端原文**。能删的队已经 `closed`，删失败意味着它
 *    还在；把面板清掉只会让「它还在」这件事不可见。
 *
 * 另外钉住与关闭的一处刻意差异：失败时**不重取快照**（快照不会因一次失败的删除而变），
 * 但**要**重取列表（竞态下那一行可能真的已经没了）。
 */

const mockInvoke = vi.mocked(invoke);

function reset(): void {
  __resetTeamGenerationForTests();
  useTeamStore.setState({
    teamId: null,
    snapshot: null,
    detail: null,
    loading: false,
    error: null,
    lastRev: 0,
  });
  mockInvoke.mockReset();
}

describe('useTeamDelete', () => {
  beforeEach(reset);

  it('成功 + 删的是当前打开的队 ⇒ 清 store（否则下一次脉冲会拉一个不存在的快照）', async () => {
    useTeamStore.setState({
      teamId: 'tm_1',
      snapshot: createTeamSnapshot({ team: createTeam({ id: 'tm_1', state: 'closed' }) }),
    });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_delete') return null;
      return undefined;
    });

    const onShowToast = vi.fn();
    const onSettled = vi.fn();
    const { result } = renderHook(() => useTeamDelete({ onShowToast, onSettled }));

    let ok = false;
    await act(async () => {
      ok = await result.current.remove('tm_1', 'refactor');
    });

    expect(ok).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('team_delete', { teamId: 'tm_1' });
    expect(useTeamStore.getState().teamId).toBeNull();
    expect(useTeamStore.getState().snapshot).toBeNull();
    expect(onShowToast).toHaveBeenCalledWith('Team "refactor" deleted', 'info');
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('成功但删的不是当前队 ⇒ **不**清 store（导航不该被无关的清理重置）', async () => {
    useTeamStore.setState({
      teamId: 'tm_other',
      snapshot: createTeamSnapshot({ team: createTeam({ id: 'tm_other' }) }),
    });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_delete') return null;
      return undefined;
    });

    const { result } = renderHook(() => useTeamDelete());
    await act(async () => {
      await result.current.remove('tm_closed', 'finished');
    });

    // 面板仍然盯着原来那个队（快照没被动过）
    expect(useTeamStore.getState().teamId).toBe('tm_other');
    expect(useTeamStore.getState().snapshot).not.toBeNull();
  });

  it('失败 ⇒ 后端原文 + 不清 store + 重取列表（但不重取快照）', async () => {
    useTeamStore.setState({
      teamId: 'tm_other',
      snapshot: createTeamSnapshot({ team: createTeam({ id: 'tm_other' }) }),
    });
    const snapshotCalls: string[] = [];
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_delete') {
        throw 'Conflict: team `tm_1` is active and still owns member processes';
      }
      if (cmd === 'team_snapshot') {
        snapshotCalls.push(cmd);
        return createTeamSnapshot();
      }
      return undefined;
    });

    const onShowToast = vi.fn();
    const onSettled = vi.fn();
    const { result } = renderHook(() => useTeamDelete({ onShowToast, onSettled }));

    let ok = true;
    await act(async () => {
      ok = await result.current.remove('tm_1', 'refactor');
    });

    expect(ok).toBe(false);
    // 后端原文不加工（它说的是「先关闭」，不是「操作失败」）
    expect(result.current.error).toBe(
      'Conflict: team `tm_1` is active and still owns member processes',
    );
    expect(onShowToast).toHaveBeenCalledWith(result.current.error, 'error');
    // store 不清：那个队还在，面板不该被重置
    expect(useTeamStore.getState().teamId).toBe('tm_other');
    // 列表要重取（竞态下那一行可能真的没了）；快照不重取（它不会因失败的删除而变）
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(snapshotCalls).toHaveLength(0);
  });

  it('在飞期间记下**是哪个队**在删（按队置灰，不是全局 busy）', async () => {
    let release: (() => void) | null = null;
    mockInvoke.mockImplementation(
      async (cmd) =>
        new Promise<void>((resolve) => {
          if (cmd === 'team_delete') release = resolve;
        }),
    );

    const { result } = renderHook(() => useTeamDelete());
    expect(result.current.deletingTeamId).toBeNull();

    let pending: Promise<boolean> | null = null;
    act(() => {
      pending = result.current.remove('tm_1', 'refactor');
    });
    await waitFor(() => expect(result.current.deletingTeamId).toBe('tm_1'));

    await act(async () => {
      release?.();
      await pending;
    });
    expect(result.current.deletingTeamId).toBeNull();
  });

  it('两个不同的队可以并行删：先落地的那个不会把另一个的标记抹掉', async () => {
    // 删除是**按队**的动作：后端 `delete_team` 按 `team_id` 定位，两行之间没有共享状态。
    // 用全局布尔就会让「删 A 时 B 的按钮也变灰」，而 B 的删除本来完全成立。
    const releases: Array<() => void> = [];
    mockInvoke.mockImplementation(
      async (cmd) =>
        new Promise<void>((resolve) => {
          if (cmd === 'team_delete') releases.push(resolve);
        }),
    );

    const { result } = renderHook(() => useTeamDelete());
    let first: Promise<boolean> | null = null;
    let second: Promise<boolean> | null = null;
    act(() => {
      first = result.current.remove('tm_a', 'a');
      second = result.current.remove('tm_b', 'b');
    });
    await waitFor(() => expect(releases).toHaveLength(2));
    // 最后发起的那个是「正在删」的那个（单值字段的既定语义）
    expect(result.current.deletingTeamId).toBe('tm_b');

    // 让 **tm_a** 先落地：它不该把 tm_b 的标记清掉
    await act(async () => {
      releases[0]();
      await first;
    });
    expect(result.current.deletingTeamId).toBe('tm_b');

    await act(async () => {
      releases[1]();
      await second;
    });
    expect(result.current.deletingTeamId).toBeNull();
  });
});

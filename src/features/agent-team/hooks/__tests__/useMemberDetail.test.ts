import { listen } from '@tauri-apps/api/event';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemberDetail } from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import {
  __resetTeamGenerationForTests,
  __resetTeamPulseForTests,
  useTeamStore,
} from '../../store/teamStore';
import { useMemberDetail } from '../useMemberDetail';
import { PULSE_COALESCE_MS } from '../usePulseRefresh';

/**
 * 成员详情也走**同一套**失效实现（`usePulseRefresh`），不各写一份。
 *
 * 这是「一次拉数」的四件事里最容易各写一遍的那一块：成员详情**没有**自己的事件流，
 * 它只能跟着团队脉冲走。修之前它是「`rev` 变一次就立刻拉一次」—— 与列表 / 快照的时机
 * 语义不一致（一次动作连发多条脉冲 ⇒ 多次全量拉取 + 响应乱序）。
 */

type ListenCb = (event: { payload: unknown }) => void;

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

let handlers: ListenCb[];

function emit(rev: number): void {
  act(() => {
    for (const handler of handlers) handler({ payload: { rev } });
  });
}

async function flush(ms = PULSE_COALESCE_MS): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function countCalls(cmd: string): number {
  return mockInvoke.mock.calls.filter(([name]) => name === cmd).length;
}

describe('useMemberDetail — 脉冲驱动的重取', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    handlers = [];
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async () => createMemberDetail());
    mockListen.mockReset();
    mockListen.mockImplementation((async (_event: string, cb: ListenCb) => {
      handlers.push(cb);
      return vi.fn();
    }) as unknown as typeof listen);
    __resetTeamGenerationForTests();
    __resetTeamPulseForTests();
    useTeamStore.setState({
      teamId: 'tm_1',
      snapshot: null,
      detail: null,
      loading: false,
      error: null,
      lastRev: 0,
    });
  });

  it('打开即拉一次（带的是这个成员 id）', async () => {
    const { result } = renderHook(() => useMemberDetail('w1@tm_1'));
    await flush(0);

    expect(mockInvoke).toHaveBeenCalledWith('team_member_detail', { memberId: 'w1@tm_1' });
    expect(result.current.detail?.member.memberId).toBe('w1@tm_1');
  });

  it('脉冲 → 重取；一次动作的 3 条脉冲只重取 1 次（与列表/快照同一份合并窗口）', async () => {
    renderHook(() => useMemberDetail('w1@tm_1'));
    await flush(0);

    emit(1);
    await flush(0);
    emit(2);
    await flush(0);
    emit(3);
    await flush();

    expect(countCalls('team_member_detail')).toBe(2); // 首拉 + 一次合并刷新
  });

  it('抽屉关着（memberId 为 null）时不参与刷新', async () => {
    renderHook(() => useMemberDetail(null));
    await flush(0);

    emit(1);
    await flush();

    expect(countCalls('team_member_detail')).toBe(0);
  });

  it('卸载后不再重取（闩）', async () => {
    const { unmount } = renderHook(() => useMemberDetail('w1@tm_1'));
    await flush(0);

    emit(1); // 排进窗口
    unmount();
    await flush();

    expect(countCalls('team_member_detail')).toBe(1);
  });

  it('失败不清数据（闪空比旧数据更糟）', async () => {
    const { result } = renderHook(() => useMemberDetail('w1@tm_1'));
    await flush(0);
    expect(result.current.detail).not.toBeNull();

    mockInvoke.mockRejectedValueOnce('Not found: member `w1@tm_1` is not loaded');
    emit(1);
    await flush();

    expect(result.current.error).toBe('Not found: member `w1@tm_1` is not loaded');
    expect(result.current.detail).not.toBeNull();
  });
});

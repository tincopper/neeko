import { listen } from '@tauri-apps/api/event';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_TEAM_EVENT } from '@/shared/events';
import { createTeamSnapshot } from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import { __resetTeamGenerationForTests, useTeamStore } from '../../store/teamStore';
import { PULSE_COALESCE_MS, useTeamPanel } from '../useTeamPanel';

/**
 * 脉冲订阅与合并刷新（红线 4 在**时间维度**上的落点）。
 *
 * 三条行为分别对应三种现场故障：
 *
 * | 行为 | 少了它会怎样 |
 * | --- | --- |
 * | `rev` 去重 | 一次动作连发 3 条脉冲 ⇒ 3 次全量拉取，且响应乱序，旧快照盖回新快照 |
 * | 合并窗口 | 同上，只是 3 次变成 3 个 timer |
 * | 卸载退订 | 面板开合 N 次后 N 个监听同时在拉，每次写都放大成 N 次 invoke |
 *
 * 事件名必须来自 `src/shared/events.ts`（红线 5），所以这里断言的是常量本身而不是字面量。
 */

type ListenCb = (event: { payload: unknown }) => void;

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

let handlers: ListenCb[];
const unlistenSpy = vi.fn();

const snapshot = createTeamSnapshot();

function emit(rev: number): void {
  act(() => {
    for (const handler of handlers) handler({ payload: { rev } });
  });
}

/** 让排队的 timer 与它触发的 promise 链都跑完（fake timers 下 waitFor 不可用）。 */
async function flush(ms = PULSE_COALESCE_MS): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useTeamPanel — 首拉与脉冲合并', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    handlers = [];
    unlistenSpy.mockReset();
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd) => (cmd === 'team_snapshot' ? snapshot : undefined));
    mockListen.mockReset();
    mockListen.mockImplementation((async (_event: string, cb: ListenCb) => {
      handlers.push(cb);
      return unlistenSpy;
    }) as unknown as typeof listen);
    __resetTeamGenerationForTests();
    useTeamStore.setState({
      teamId: 'tm_1',
      snapshot: null,
      detail: null,
      loading: false,
      error: null,
      lastRev: 0,
    });
  });

  it('挂载即拉一次快照，并订阅团队事件（事件名来自单一常量源）', async () => {
    renderHook(() => useTeamPanel());
    await flush(0);

    expect(mockInvoke).toHaveBeenCalledWith('team_snapshot', { teamId: 'tm_1' });
    expect(mockListen).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledWith(AGENT_TEAM_EVENT, expect.any(Function));
    expect(AGENT_TEAM_EVENT).toBe('agent-team://event');
  });

  it('revision 更新的脉冲触发一次重取；同一或更旧的 rev 不触发', async () => {
    renderHook(() => useTeamPanel());
    await flush(0);
    mockInvoke.mockClear();

    emit(5);
    await flush();
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    mockInvoke.mockClear();
    // 同一条脉冲（每个写路径各发一条，代数是同一个）→ 不许再拉
    emit(5);
    await flush();
    expect(mockInvoke).not.toHaveBeenCalled();

    // 乱序到达的旧脉冲 → 同样不许拉，且水位线不回退
    emit(4);
    await flush();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useTeamStore.getState().lastRev).toBe(5);
  });

  it('连续 3 个脉冲只产生 1 次 invoke（爆发合并）', async () => {
    renderHook(() => useTeamPanel());
    await flush(0);
    mockInvoke.mockClear();

    emit(1);
    emit(2);
    emit(3);
    await flush();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(useTeamStore.getState().lastRev).toBe(3);
  });

  it('在飞期间到达的脉冲在落地后补一次（合并但不丢最后一次变化）', async () => {
    renderHook(() => useTeamPanel());
    await flush(0);
    mockInvoke.mockClear();

    let calls = 0;
    let releaseFirst: (() => void) | null = null;
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mockInvoke.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) await held;
      return snapshot;
    });

    emit(1);
    await flush();
    expect(calls).toBe(1); // 第一次刷新还挂在那里

    emit(2); // 在飞期间的新变化
    await flush();
    expect(calls).toBe(1); // 没有并发发起第二次

    releaseFirst?.();
    await flush();
    expect(calls).toBe(2); // 落地后补了一次 → 最后一拍变化没被吞掉
  });

  it('卸载后退订：unlisten 被调用，后续脉冲不再触发拉取', async () => {
    const { unmount } = renderHook(() => useTeamPanel());
    await flush(0);
    expect(handlers).toHaveLength(1);

    unmount();
    await flush(0);
    expect(unlistenSpy).toHaveBeenCalledTimes(1);

    mockInvoke.mockClear();
    emit(9);
    await flush();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('没有 teamId（空态）时不订阅、不拉快照', async () => {
    useTeamStore.setState({ teamId: null });
    renderHook(() => useTeamPanel());
    await flush();

    expect(mockListen).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

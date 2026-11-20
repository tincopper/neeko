import { listen } from '@tauri-apps/api/event';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_TEAM_EVENT } from '@/shared/events';
import { createTeamSnapshot } from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import {
  __resetTeamGenerationForTests,
  __resetTeamPulseForTests,
  useTeamStore,
} from '../../store/teamStore';
import { PULSE_COALESCE_MS } from '../usePulseRefresh';
import { useTeamPanel } from '../useTeamPanel';

/**
 * 面板数据装配（首拉 + 脉冲驱动的合并刷新）。
 *
 * 订阅的归属变了：`listen(AGENT_TEAM_EVENT)` 现在只有 `teamStore` 一个所有者，三个读面
 * 共用它（见 `store/teamStore` / `hooks/usePulseRefresh`）。所以这里的判据也变了：
 *
 * | 判据 | 少了它会怎样 |
 * | --- | --- |
 * | 挂载 / 换队即时首拉 | 打开面板只剩一条空板，直到有人动一下 |
 * | 脉冲 → 合并重取 | 一次动作 3 条脉冲放大成 3 次全量拉取，响应乱序盖回旧数据 |
 * | 在飞期间记一个待办 | 刷新期间的最后一次变化被吞掉 |
 * | 卸载后不再拉取 | 面板没了还在 invoke |
 *
 * 「谁订阅」由 `usePulseRefresh.test.ts` 钉（含 `listen` 只调一次）；这里只钉面板这一侧。
 */

type ListenCb = (event: { payload: unknown }) => void;

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

let handlers: ListenCb[];

const snapshot = createTeamSnapshot();

function emit(rev: number): void {
  act(() => {
    for (const handler of handlers) handler({ payload: { rev } });
  });
}

/** 让排队的 timer 与它触发的 promise 链都跑完（fake timers 下 `waitFor` 不可用）。 */
async function flush(ms = PULSE_COALESCE_MS): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useTeamPanel — 首拉与脉冲合并', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    handlers = [];
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd) => (cmd === 'team_snapshot' ? snapshot : undefined));
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

  it('挂载即拉一次快照（事件名来自单一常量源）', async () => {
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

    // 三条脉冲**分三次**落地（每个写路径各一条，中间隔着一次渲染）：
    // 同一批里的多条会被 React 的批处理自然合并，那样这个用例就测不到合并窗口了。
    emit(1);
    await flush(0);
    emit(2);
    await flush(0);
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

  it('卸载后不再拉取（订阅留在 store，但本面板不再唤醒请求）', async () => {
    const { unmount } = renderHook(() => useTeamPanel());
    await flush(0);

    unmount();
    await flush(0);
    mockInvoke.mockClear();

    // 排进窗口之后卸载：那道窗口也必须被清掉
    emit(9);
    await flush();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('没有 teamId（列表态）时不拉快照（列表页自己订阅刷新）', async () => {
    useTeamStore.setState({ teamId: null });
    renderHook(() => useTeamPanel());
    await flush();

    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

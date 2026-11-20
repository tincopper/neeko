import { listen } from '@tauri-apps/api/event';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetTeamGenerationForTests,
  __resetTeamPulseForTests,
  useTeamStore,
} from '../../store/teamStore';
import { PULSE_COALESCE_MS, usePulseRefresh } from '../usePulseRefresh';

/**
 * 共享的「脉冲 → 合并刷新」实现（三处读面共用这一份）。
 *
 * 四条判据都是**现场故障**的机器形式：
 *
 * | 判据 | 少了它会怎样 |
 * | --- | --- |
 * | 陈旧脉冲不刷新 | 一次动作连发多条 ⇒ 多次全量拉取，响应乱序，旧数据盖回新数据 |
 * | 合并窗口 | 同上，只是多条变成多个 timer |
 * | 在飞期间记一个待办 | 刷新期间的最后一次变化被永久吞掉（面板停在旧值）|
 * | 卸载闩 | 面板开合 N 次后 N 个窗口同时排拉取，每次写都放大成 N 次 invoke |
 *
 * 订阅本身不在这里：`teamStore` 是 `listen(AGENT_TEAM_EVENT)` 的唯一所有者，本 hook 只读
 * `lastRev` 这个状态（见 `store/teamStore` 的模块注释）。
 */

type ListenCb = (event: { payload: unknown }) => void;

const mockListen = vi.mocked(listen);

let handlers: ListenCb[];

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

describe('usePulseRefresh — 合并 / 排队 / 卸载闩', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    handlers = [];
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

  it('一次动作连发 3 条脉冲 → 只刷新 1 次（合并窗口）', async () => {
    const refresh = vi.fn(async () => undefined);
    renderHook(() => usePulseRefresh(refresh));
    await flush(0);

    // 三条脉冲**分三次**落地（每个写路径各一条，中间隔着一次渲染）：
    // 同一批里的多条会被 React 的批处理自然合并，那样这个用例就测不到合并窗口了。
    emit(1);
    await flush(0);
    emit(2);
    await flush(0);
    emit(3);
    await flush();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(useTeamStore.getState().lastRev).toBe(3);
  });

  it('陈旧脉冲（同一代数 / 更旧的代数）不触发任何刷新', async () => {
    const refresh = vi.fn(async () => undefined);
    renderHook(() => usePulseRefresh(refresh));
    await flush(0);

    emit(5);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);

    emit(5); // 每个写路径各发一条，代数是同一个
    emit(4); // 乱序到达的旧脉冲
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(useTeamStore.getState().lastRev).toBe(5);
  });

  it('在飞期间到达的脉冲在落地后补一次（合并，但不丢最后一次变化）', async () => {
    let release: (() => void) | null = null;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const refresh = vi.fn(async () => {
      calls += 1;
      if (calls === 1) await held;
    });

    renderHook(() => usePulseRefresh(refresh));
    await flush(0);

    emit(1);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1); // 第一拉还挂在那里

    emit(2);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1); // 没有并发发起第二次

    release?.();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(2); // 落地后补了一次
  });

  it('卸载后不再刷新（即使排队中的窗口还没到点）', async () => {
    const refresh = vi.fn(async () => undefined);
    const { unmount } = renderHook(() => usePulseRefresh(refresh));
    await flush(0);

    emit(1); // 排进窗口，但还没到点
    unmount();
    await flush();
    expect(refresh).not.toHaveBeenCalled();

    // 卸载之后的新脉冲也不会唤醒任何请求
    emit(2);
    await flush();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('enabled=false 时不刷新；关到开也不拿一条旧代数补一次', async () => {
    const refresh = vi.fn(async () => undefined);
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => usePulseRefresh(refresh, { enabled }),
      { initialProps: { enabled: false } },
    );
    await flush(0);

    emit(4);
    await flush();
    expect(refresh).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await flush();
    expect(refresh).not.toHaveBeenCalled(); // 旧代数不补拉

    emit(5);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1); // 新代数照常
  });

  it('全局订阅只建立一次（store 是唯一订阅者，多个读面共用一份）', async () => {
    const a = vi.fn(async () => undefined);
    const b = vi.fn(async () => undefined);
    renderHook(() => {
      usePulseRefresh(a);
      usePulseRefresh(b);
    });
    await flush(0);

    expect(mockListen).toHaveBeenCalledTimes(1);

    emit(1);
    await flush();
    // 一块数据一个刷新函数：同一个脉冲各唤醒一次（各拉各的），但不是各订阅一份事件
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

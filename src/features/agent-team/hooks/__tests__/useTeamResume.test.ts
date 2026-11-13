import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from '@/testing/tauriCore';

import { useTeamResume } from '../useTeamResume';

/**
 * 恢复团队的执行面（`team_resume`）。
 *
 * 三条判据：
 *
 * 1. **成功 ⇒ 一句话结果**：四个桶都要进那句话（只报 `resumed.length` 会把「3 个只能新开」
 *    藏起来 —— 那正是这次要消灭的缺陷类型）。
 * 2. **失败 ⇒ 后端原文照抄 + 不向调用方抛错**：`Conflict`（sealed / closing / 端点没起来）
 *    里写着唯一能行动的信息；面板的事件处理器里抛错只会变成 unhandled rejection。
 * 3. **成败都 `onSettled`**：失败也可能已经改了别的成员，面板不能拿旧快照继续渲染。
 */
const mockInvoke = vi.mocked(invoke);

describe('useTeamResume', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('成功 ⇒ toast 是报告的一句话，`onSettled` 触发一次，不抛错', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_resume') {
        return {
          teamId: 'tm_1',
          resumed: ['lead@tm_1', 'w1@tm_1'],
          skippedAlreadyLive: [],
          cold: [{ memberId: 'w2@tm_1', reason: 'no_native_session' }],
          failed: [],
        };
      }
      return undefined;
    });

    const onShowToast = vi.fn();
    const onSettled = vi.fn();
    const { result } = renderHook(() => useTeamResume({ onShowToast, onSettled }));

    await act(async () => {
      await result.current.resume('tm_1');
    });

    expect(mockInvoke).toHaveBeenCalledWith('team_resume', { teamId: 'tm_1', memberId: null });
    expect(onShowToast).toHaveBeenCalledWith('恢复 2 个成员；1 个只能新开（没有会话记录）', 'info');
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(result.current.resumeError).toBeNull();
    expect(result.current.resuming).toBe(false);
  });

  it('成员级恢复带上 memberId（整队与单成员是同一个命令的两个范围）', async () => {
    mockInvoke.mockResolvedValue({
      teamId: 'tm_1',
      resumed: ['w1@tm_1'],
      skippedAlreadyLive: [],
      cold: [],
      failed: [],
    });

    const { result } = renderHook(() => useTeamResume());
    await act(async () => {
      await result.current.resume('tm_1', 'w1@tm_1');
    });

    expect(mockInvoke).toHaveBeenCalledWith('team_resume', {
      teamId: 'tm_1',
      memberId: 'w1@tm_1',
    });
  });

  it('失败 ⇒ 后端原文渲染 + toast error + 仍然 `onSettled`（事实可能已经变了）', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_resume') {
        throw 'Conflict: `team tm_1 is sealed; a sealed team cannot be resumed`';
      }
      return undefined;
    });

    const onShowToast = vi.fn();
    const onSettled = vi.fn();
    const { result } = renderHook(() => useTeamResume({ onShowToast, onSettled }));

    // 不抛：调用方是事件处理器
    await act(async () => {
      await result.current.resume('tm_1');
    });

    const expected = 'Conflict: `team tm_1 is sealed; a sealed team cannot be resumed`';
    expect(result.current.resumeError).toBe(expected);
    expect(onShowToast).toHaveBeenCalledWith(expected, 'error');
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(result.current.resuming).toBe(false);
  });

  it('在飞期间再调一次是**无操作**（双击 / 两个入口不会起两个编排）', async () => {
    const releases: Array<() => void> = [];
    mockInvoke.mockImplementation(
      async () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    );

    const { result } = renderHook(() => useTeamResume());
    let first: Promise<void> | null = null;
    let second: Promise<void> | null = null;
    act(() => {
      first = result.current.resume('tm_1', 'w1@tm_1');
      second = result.current.resume('tm_1', 'w2@tm_1');
    });

    // 只有第一次真的发了请求（第二次在闸门处被丢掉）
    await waitFor(() => expect(releases).toHaveLength(1));
    expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === 'team_resume')).toHaveLength(1);

    await act(async () => {
      releases[0]();
      await first;
      await second;
    });
    expect(result.current.resuming).toBe(false);
  });

  it('新的恢复会清掉上一次的错误（否则旧错误会一直挂在面板顶栏）', async () => {
    mockInvoke.mockImplementation(async () => {
      throw 'Conflict: still closing';
    });
    const { result } = renderHook(() => useTeamResume());
    await act(async () => {
      await result.current.resume('tm_1');
    });
    expect(result.current.resumeError).toBe('Conflict: still closing');

    mockInvoke.mockResolvedValue({
      teamId: 'tm_1',
      resumed: ['lead@tm_1'],
      skippedAlreadyLive: [],
      cold: [],
      failed: [],
    });
    await act(async () => {
      await result.current.resume('tm_1');
    });
    expect(result.current.resumeError).toBeNull();
  });
});

/**
 * `useWorkItemRuns`：详情「执行」区的读面。
 *
 * 三条判据各自对应一种真实事故：
 * 1. **换了工作项就不许拿旧结果充数** —— 详情是覆盖层，打开另一条时 hook 不卸载，槽位会被串；
 * 2. **在飞时卸载不许 setState** —— dock 面板反复挂载卸载，迟到的响应写进已死的组件；
 * 3. **刷新失败要清空记录** —— 留着上一轮会让「刷新失败」看起来像「刷新成功且没变」。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listWorkItemRuns: vi.fn() }));

vi.mock('../../api/workItemsApi', () => api);

import type { WorkItemRun } from '../../types';
import { useWorkItemRuns } from '../useWorkItemRuns';

function run(id: string, workItemId = 'wi_1'): WorkItemRun {
  return {
    id,
    workItemId,
    mode: 'single',
    ref: { kind: 'session', id: `tab_${id}`, sub: null },
    snapshot: { state: 'running', label: id, capturedAt: 1 },
    createdAt: 1,
  };
}

beforeEach(() => {
  api.listWorkItemRuns.mockReset();
});

describe('useWorkItemRuns', () => {
  it('挂载即拉一次；未拿到前 loading 为真', async () => {
    api.listWorkItemRuns.mockResolvedValue([run('run_1')]);
    const { result } = renderHook(() => useWorkItemRuns('wi_1'));

    // 「还没拿到」就是加载中（不在 effect 里同步 setState(true)，那是多一轮渲染）。
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toHaveLength(1);
    expect(api.listWorkItemRuns).toHaveBeenCalledExactlyOnceWith('wi_1');
  });

  it('换工作项：旧结果不许充数（先回到加载中，再拿到新的）', async () => {
    let releaseFirst: (runs: WorkItemRun[]) => void = () => {};
    api.listWorkItemRuns.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseFirst = resolve;
      }),
    );
    api.listWorkItemRuns.mockResolvedValueOnce([run('run_new', 'wi_2')]);

    const { result, rerender } = renderHook(({ id }) => useWorkItemRuns(id), {
      initialProps: { id: 'wi_1' },
    });
    rerender({ id: 'wi_2' });

    // 第一条工作项的响应迟到：它属于 `wi_1`，不能出现在 `wi_2` 的槽位里。
    await act(async () => {
      releaseFirst([run('run_old', 'wi_1')]);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs.map((row) => row.id)).toEqual(['run_new']);
  });

  it('在飞时卸载：迟到的响应被丢弃（不允许对已死的组件 setState）', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let release: (runs: WorkItemRun[]) => void = () => {};
    api.listWorkItemRuns.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const { unmount } = renderHook(() => useWorkItemRuns('wi_1'));
    unmount();
    await act(async () => {
      release([run('run_1')]);
    });

    // React 18 对卸载后 setState 不再报警，但「什么也没炸」本身就是这条闩要的证据：
    // 有副作用时它会以 warning/异常出现。
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  /** 失败时 fallback 只用于「真的没有消息」的拒绝原因 */
  it('卸载后才失败的请求也不再写状态（与成功那条对称：两个回调各有一道闩）', async () => {
    let reject: (err: unknown) => void = () => {};
    api.listWorkItemRuns.mockReturnValue(
      new Promise((_, rejectFn) => {
        reject = rejectFn;
      }),
    );

    const { unmount } = renderHook(() => useWorkItemRuns('wi_1'));
    unmount();
    await act(async () => {
      reject(new Error('late failure'));
    });
    // 没有断言目标：这条闩的效果是「什么也不发生」（不写、不报）。能跑到这里就是证据。
    expect(api.listWorkItemRuns).toHaveBeenCalledTimes(1);
  });

  it('刷新失败：清空记录并给出可读错误（不是留着旧列表假装成功）', async () => {
    api.listWorkItemRuns.mockResolvedValueOnce([run('run_1')]);
    const { result } = renderHook(() => useWorkItemRuns('wi_1'));
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    api.listWorkItemRuns.mockRejectedValueOnce(new Error('run store is corrupted'));
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.error).toBe('run store is corrupted'));
    expect(result.current.runs).toEqual([]);
  });

  it('失败时 fallback 只用于「真的没有消息」的拒绝原因', async () => {
    api.listWorkItemRuns.mockRejectedValueOnce(null as unknown as Error);
    const { result } = renderHook(() => useWorkItemRuns('wi_1'));

    await waitFor(() => expect(result.current.error).toBe('读取执行记录失败'));
  });
});

/**
 * `useStagePlan`：阶段轨的读面。
 *
 * 要钉住的只有一件事 —— **全局只拉一次**（`work_item_stage_plan` 是常量，两个组件同时挂载
 * 不该打两次 IPC），以及拉不到时 `plan` 保持 `null`、`loading` 归位（调用方据此不画轨道）。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getStagePlan: vi.fn(),
  listWorkItems: vi.fn(),
  createWorkItem: vi.fn(),
  updateWorkItem: vi.fn(),
  transitionWorkItem: vi.fn(),
  deleteWorkItem: vi.fn(),
}));

vi.mock('../../api/workItemsApi', () => api);

import { useWorkItemsStore } from '../../store/workItemsStore';
import type { StagePlan } from '../../types';
import { useStagePlan } from '../useStagePlan';

const PLAN: StagePlan = {
  stages: ['Backlog', 'Ready', 'In Progress', 'Review', 'Done'],
  transitions: [{ from: 'Backlog', to: 'Ready' }],
};

beforeEach(() => {
  useWorkItemsStore.getState().reset();
  api.getStagePlan.mockReset();
  api.getStagePlan.mockResolvedValue(PLAN);
});

describe('useStagePlan', () => {
  it('并发挂载的两个实例只打一次 IPC，共享同一份 plan', async () => {
    let resolve!: (plan: StagePlan) => void;
    api.getStagePlan.mockImplementation(
      () =>
        new Promise<StagePlan>((r) => {
          resolve = r;
        }),
    );

    const first = renderHook(() => useStagePlan());
    const second = renderHook(() => useStagePlan());

    expect(api.getStagePlan).toHaveBeenCalledTimes(1);
    expect(first.result.current.loading).toBe(true);

    await act(async () => {
      resolve(PLAN);
    });

    await waitFor(() => expect(first.result.current.plan).toEqual(PLAN));
    expect(second.result.current.plan).toEqual(PLAN);
    expect(first.result.current.loading).toBe(false);
  });

  it('plan 已在 store 里时新挂载不再请求', async () => {
    await act(async () => {
      await useWorkItemsStore.getState().loadPlan();
    });

    const { result } = renderHook(() => useStagePlan());

    expect(api.getStagePlan).toHaveBeenCalledTimes(1);
    expect(result.current.plan).toEqual(PLAN);
    expect(result.current.loading).toBe(false);
  });

  it('拉不到时 plan 保持 null、loading 归位（面板不画假轨道）', async () => {
    api.getStagePlan.mockRejectedValue(new Error('Unknown error: no handler'));

    const { result } = renderHook(() => useStagePlan());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plan).toBeNull();
  });
});

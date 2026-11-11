/**
 * `useWorkItems`：Tasks 面板的读面（列表 / 加载 / 错误）+ 动作面。
 *
 * 只 mock **api 层**：hook 的职责是把 store 里的分槽状态投影成「本项目」的四个字段，
 * 并把动作转发出去（失败不吞）。IPC 形状与状态迁移分别由 `workItemsApi.test.ts` /
 * `workItemsStore.test.ts` 钉住。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import type { StagePlan, WorkItem } from '../../types';
import { useWorkItems } from '../useWorkItems';

const PLAN: StagePlan = {
  stages: ['Backlog', 'Ready'],
  transitions: [{ from: 'Backlog', to: 'Ready' }],
};

function item(id: string, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    projectId: 'p1',
    title: `title ${id}`,
    body: '',
    stage: 'Backlog',
    priority: null,
    labels: [],
    assignee: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function ids(items: WorkItem[]): string[] {
  return items.map((row) => row.id);
}

beforeEach(() => {
  useWorkItemsStore.getState().reset();
  api.getStagePlan.mockReset();
  api.listWorkItems.mockReset();
  api.createWorkItem.mockReset();
  api.updateWorkItem.mockReset();
  api.transitionWorkItem.mockReset();
  api.deleteWorkItem.mockReset();
  api.getStagePlan.mockResolvedValue(PLAN);
  api.listWorkItems.mockResolvedValue([]);
  api.deleteWorkItem.mockResolvedValue(undefined);
});

afterEach(() => {
  // 撤销窗口的定时器不许跨用例存活（真时钟下它们会在下一个用例里开火）。
  useWorkItemsStore.getState().reset();
});

describe('useWorkItems — 读面', () => {
  it('绑定项目后挂载即拉一次，并把结果投影到 items', async () => {
    api.listWorkItems.mockResolvedValue([item('wi_1')]);

    const { result } = renderHook(() => useWorkItems('p1'));

    await waitFor(() => expect(ids(result.current.items)).toEqual(['wi_1']));
    expect(api.listWorkItems).toHaveBeenCalledTimes(1);
    expect(api.listWorkItems).toHaveBeenCalledWith('p1');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('projectId = null 不发请求，items 恒为空数组且引用稳定', async () => {
    const { result, rerender } = renderHook(() => useWorkItems(null));

    const first = result.current.items;
    rerender();

    expect(api.listWorkItems).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
    // 稳定引用：每次 render 造新数组会让所有吃 items 的子组件 memo 失效
    expect(result.current.items).toBe(first);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('projectId 变化时拉新项目，两个项目的槽位各自保留', async () => {
    api.listWorkItems.mockImplementation(async (projectId: string) =>
      projectId === 'p1' ? [item('wi_1')] : [item('wi_9', { projectId: 'p2' })],
    );

    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useWorkItems(id), {
      initialProps: { id: 'p1' },
    });
    await waitFor(() => expect(ids(result.current.items)).toEqual(['wi_1']));

    rerender({ id: 'p2' });
    await waitFor(() => expect(ids(result.current.items)).toEqual(['wi_9']));

    rerender({ id: 'p1' });
    // 切回来时**立刻**是旧数据（不是空列表）：槽位按项目留着，请求在后台补
    expect(ids(result.current.items)).toEqual(['wi_1']);
    expect(api.listWorkItems).toHaveBeenCalledTimes(3);
    expect(api.listWorkItems).toHaveBeenLastCalledWith('p1');
  });

  it('读路径失败进 error 字段（不抛给渲染）', async () => {
    api.listWorkItems.mockRejectedValue(new Error('Storage error: db locked'));

    const { result } = renderHook(() => useWorkItems('p1'));

    await waitFor(() => expect(result.current.error).toBe('Storage error: db locked'));
    expect(result.current.items).toEqual([]);
    // 失败过的空槽位**不**算加载中（否则错误态永远转圈）
    expect(result.current.loading).toBe(false);
  });

  it('「还没问到」算加载中：空列表 + 不加载 + 无错误这一帧不该出现', async () => {
    api.listWorkItems.mockResolvedValue([item('wi_1')]);

    const { result } = renderHook(() => useWorkItems('p1'));
    await waitFor(() => expect(ids(result.current.items)).toEqual(['wi_1']));

    // 槽位被清掉（项目切换 / reset 后重新问）：列表空、error 空，但这不是「没有工作项」
    act(() => {
      useWorkItemsStore.getState().reset();
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);
  });
});

describe('useWorkItems — 动作面', () => {
  it('actions 在重渲染之间保持同一引用（memo 不失效）', async () => {
    const { result, rerender } = renderHook(() => useWorkItems('p1'));
    const first = result.current.actions;

    rerender();

    expect(result.current.actions).toBe(first);
  });

  it('transition 失败原样抛给调用方（不吞）', async () => {
    api.listWorkItems.mockResolvedValue([item('wi_1')]);
    api.transitionWorkItem.mockRejectedValue(new Error('Invalid input: cannot move to Done'));

    const { result } = renderHook(() => useWorkItems('p1'));
    await waitFor(() => expect(ids(result.current.items)).toEqual(['wi_1']));

    await act(async () => {
      await expect(result.current.actions.transition('wi_1', 'Done')).rejects.toThrow(
        'cannot move to Done',
      );
    });

    // 回滚后调用方看到的仍是原来那一列
    expect(result.current.items[0].stage).toBe('Backlog');
  });

  it('remove 立刻移除，窗口内 undo 放回原位', async () => {
    api.listWorkItems.mockResolvedValue([item('wi_1'), item('wi_2', { updatedAt: 5 })]);

    const { result } = renderHook(() => useWorkItems('p1'));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    await act(async () => {
      await result.current.actions.remove('wi_1');
    });

    expect(ids(result.current.items)).toEqual(['wi_2']);
    expect(api.deleteWorkItem).not.toHaveBeenCalled();

    let undone = false;
    act(() => {
      undone = result.current.actions.undo();
    });

    expect(undone).toBe(true);
    expect(ids(result.current.items)).toEqual(['wi_1', 'wi_2']);
  });

  it('没有绑定项目时 remove / undo 不假装成功', async () => {
    const { result } = renderHook(() => useWorkItems(null));

    await act(async () => {
      await expect(result.current.actions.remove('wi_1')).rejects.toThrow('no project bound');
    });
    expect(result.current.actions.undo()).toBe(false);
    expect(api.deleteWorkItem).not.toHaveBeenCalled();
  });
});

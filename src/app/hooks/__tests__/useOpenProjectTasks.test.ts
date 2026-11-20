import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppViewStore } from '@/shared/store/appViewStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { useOpenProjectTasks } from '../useOpenProjectTasks';

describe('useOpenProjectTasks — 项目级 Tasks 入口（design §4.2c）', () => {
  beforeEach(() => {
    useAppViewStore.setState({ appView: 'normal' });
  });

  it('先切项目，再进 Tasks（顺序不可交换）', () => {
    // 记录两者的发生顺序：工作项按 projectId 分槽，反过来的顺序会先渲染上一个项目的数据。
    const calls: string[] = [];
    const selectProject = vi.fn((projectId: ProjectId) => {
      calls.push(`select:${projectId}`);
    });
    const setAppView = vi
      .spyOn(useAppViewStore.getState(), 'setAppView')
      .mockImplementation((v) => {
        calls.push(`view:${v}`);
        useAppViewStore.setState({ appView: v });
      });

    const { result } = renderHook(() => useOpenProjectTasks(selectProject));
    act(() => {
      result.current('p-2' as ProjectId);
    });

    expect(calls).toEqual(['select:p-2', 'view:tasks']);
    expect(useAppViewStore.getState().appView).toBe('tasks');

    setAppView.mockRestore();
  });

  it('已经在 Tasks 时点另一个项目 → 只换项目，不关面板（入口不是开关）', () => {
    useAppViewStore.setState({ appView: 'tasks' });
    const selectProject = vi.fn();

    const { result } = renderHook(() => useOpenProjectTasks(selectProject));
    act(() => {
      result.current('p-3' as ProjectId);
    });

    expect(selectProject).toHaveBeenCalledWith('p-3');
    // 与 dock 栏的 Tasks 按钮相反：那边再点一次是关，这边永远是「看这个项目」
    expect(useAppViewStore.getState().appView).toBe('tasks');
  });

  it('从 Library 切过来也落到 tasks（跨中心视图）', () => {
    useAppViewStore.setState({ appView: 'library' });
    const selectProject = vi.fn();

    const { result } = renderHook(() => useOpenProjectTasks(selectProject));
    act(() => {
      result.current('p-4' as ProjectId);
    });

    expect(useAppViewStore.getState().appView).toBe('tasks');
  });
});

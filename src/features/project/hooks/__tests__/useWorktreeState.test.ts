import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorktreeState } from '@/features/project/hooks/useWorktreeState';
import { useWorktreeStore } from '@/features/project/worktreeStore';
import { useEditorStore } from '@/shared/store';

describe('useWorktreeState', () => {
  let activeProjectId: string | null;

  beforeEach(() => {
    activeProjectId = 'project-1';
    // Reset Zustand store — useWorktreeState now reads/writes worktreeStore/editorStore
    // directly instead of local useState, so cross-test pollution must be cleaned.
    useWorktreeStore.setState({
      worktreeStateMap: {},
      activeWorktreePath: null,
      activeWorktreeBranch: '',
      openedWorktrees: [],
    });
    useEditorStore.setState({
      tabs: {},
      activeTabId: null,
    });
  });

  it('初始状态为空', () => {
    const { result } = renderHook(() => useWorktreeState(activeProjectId));

    expect(result.current.activeWorktreePath).toBeNull();
    expect(result.current.activeWorktreeBranch).toBe('');
    expect(result.current.openedWorktrees).toEqual([]);
  });

  it('null 项目 ID 时不更新状态', () => {
    const { result } = renderHook(() => useWorktreeState(null));

    act(() => {
      result.current.updateWtPath('/some/path', 'main');
    });

    expect(result.current.activeWorktreePath).toBeNull();
  });

  it('updateWtPath 同时更新路径和分支', () => {
    const { result } = renderHook(() => useWorktreeState(activeProjectId));

    act(() => {
      result.current.updateWtPath('/projects/wt1', 'feature-a');
    });

    expect(result.current.activeWorktreePath).toBe('/projects/wt1');
    expect(result.current.activeWorktreeBranch).toBe('feature-a');
  });

  it('setActiveWorktreePath 只更新路径', () => {
    const { result } = renderHook(() => useWorktreeState(activeProjectId));

    act(() => {
      result.current.setActiveWorktreePath('/projects/wt1');
    });

    expect(result.current.activeWorktreePath).toBe('/projects/wt1');
    expect(result.current.activeWorktreeBranch).toBe('');
  });

  it('setActiveWorktreeBranch 只更新分支', () => {
    const { result } = renderHook(() => useWorktreeState(activeProjectId));

    act(() => {
      result.current.setActiveWorktreeBranch('develop');
    });

    expect(result.current.activeWorktreeBranch).toBe('develop');
    expect(result.current.activeWorktreePath).toBeNull();
  });

  it('setOpenedWorktrees 直接设置列表', () => {
    const { result } = renderHook(() => useWorktreeState(activeProjectId));

    const items = [
      { path: '/projects/wt1', branch: 'main' },
      { path: '/projects/wt2', branch: 'feature' },
    ];

    act(() => {
      result.current.setOpenedWorktrees(items);
    });

    expect(result.current.openedWorktrees).toEqual(items);
  });

  it('setOpenedWorktrees 支持函数式更新', () => {
    const { result } = renderHook(() => useWorktreeState(activeProjectId));

    const items = [{ path: '/projects/wt1', branch: 'main' }];
    act(() => {
      result.current.setOpenedWorktrees(items);
    });

    act(() => {
      result.current.setOpenedWorktrees((prev) => [
        ...prev,
        { path: '/projects/wt2', branch: 'develop' },
      ]);
    });

    expect(result.current.openedWorktrees).toHaveLength(2);
    expect(result.current.openedWorktrees[1]).toEqual({
      path: '/projects/wt2',
      branch: 'develop',
    });
  });

  it('不同项目间的状态隔离', () => {
    const { result, rerender } = renderHook(
      ({ projectId }) => useWorktreeState(projectId),
      { initialProps: { projectId: 'project-1' as string | null } },
    );

    act(() => {
      result.current.updateWtPath('/project-1/wt', 'main');
    });

    rerender({ projectId: 'project-2' });
    expect(result.current.activeWorktreePath).toBeNull();
    expect(result.current.activeWorktreeBranch).toBe('');

    rerender({ projectId: 'project-1' });
    expect(result.current.activeWorktreePath).toBe('/project-1/wt');
  });
});

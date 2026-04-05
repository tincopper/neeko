import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorktreeState } from '../../hooks/useWorktreeState';

describe('useWorktreeState', () => {
  let activeProjectIdRef: React.RefObject<string | null>;

  beforeEach(() => {
    activeProjectIdRef = { current: 'project-1' };
  });

  it('初始状态为空', () => {
    const { result } = renderHook(() => useWorktreeState(activeProjectIdRef));

    expect(result.current.activeWorktreePath).toBeNull();
    expect(result.current.activeWorktreeBranch).toBe('');
    expect(result.current.openedWorktrees).toEqual([]);
  });

  it('null 项目 ID 时不更新状态', () => {
    activeProjectIdRef.current = null;
    const { result } = renderHook(() => useWorktreeState(activeProjectIdRef));

    act(() => {
      result.current.updateWtPath('/some/path', 'main');
    });

    expect(result.current.activeWorktreePath).toBeNull();
  });

  it('updateWtPath 同时更新路径和分支', () => {
    const { result } = renderHook(() => useWorktreeState(activeProjectIdRef));

    act(() => {
      result.current.updateWtPath('/projects/wt1', 'feature-a');
    });

    expect(result.current.activeWorktreePath).toBe('/projects/wt1');
    expect(result.current.activeWorktreeBranch).toBe('feature-a');
  });

  it('setActiveWorktreePath 只更新路径', () => {
    const { result } = renderHook(() => useWorktreeState(activeProjectIdRef));

    act(() => {
      result.current.setActiveWorktreePath('/projects/wt1');
    });

    expect(result.current.activeWorktreePath).toBe('/projects/wt1');
    expect(result.current.activeWorktreeBranch).toBe(''); // 分支不变
  });

  it('setActiveWorktreeBranch 只更新分支', () => {
    const { result } = renderHook(() => useWorktreeState(activeProjectIdRef));

    act(() => {
      result.current.setActiveWorktreeBranch('develop');
    });

    expect(result.current.activeWorktreeBranch).toBe('develop');
    expect(result.current.activeWorktreePath).toBeNull(); // 路径不变
  });

  it('setOpenedWorktrees 直接设置列表', () => {
    const { result } = renderHook(() => useWorktreeState(activeProjectIdRef));

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
    const { result } = renderHook(() => useWorktreeState(activeProjectIdRef));

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
    const ref1 = { current: 'project-1' } as React.RefObject<string | null>;
    const ref2 = { current: 'project-2' } as React.RefObject<string | null>;

    const { result: r1 } = renderHook(() => useWorktreeState(ref1));
    const { result: r2 } = renderHook(() => useWorktreeState(ref2));

    act(() => {
      r1.current.updateWtPath('/project-1/wt', 'main');
    });

    // project-2 的状态不受影响
    expect(r2.current.activeWorktreePath).toBeNull();
    expect(r2.current.activeWorktreeBranch).toBe('');

    // project-1 的状态独立保留
    expect(r1.current.activeWorktreePath).toBe('/project-1/wt');
  });
});

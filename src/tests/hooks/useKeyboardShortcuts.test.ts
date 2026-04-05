import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';

// mock terminal refresh functions
vi.mock('../../components/terminal', () => ({
  refreshTerminal: vi.fn(),
  refreshSideTerminal: vi.fn(),
  refreshWslTerminal: vi.fn(),
  refreshRemoteTerminal: vi.fn(),
}));

function createDefaultParams(overrides?: Partial<any>) {
  return {
    projects: [],
    activeProjectId: null,
    sideTerminalOpenRef: { current: false },
    setSideTerminalOpen: vi.fn(),
    wslEntriesRef: { current: [] },
    activeWslKeyRef: { current: null },
    selectWslProjectRef: { current: vi.fn() },
    remoteEntriesRef: { current: [] },
    activeRemoteKeyRef: { current: null },
    selectRemoteProjectRef: { current: vi.fn() },
    selectProjectRef: { current: vi.fn() },
    wslSideOpenRef: { current: new Set() },
    remoteSideOpenRef: { current: new Set() },
    setWslSideTerminalOpen: vi.fn(),
    setRemoteSideTerminalOpen: vi.fn(),
    activeWorktreePathRef: { current: null },
    openedWorktreesRef: { current: [] },
    updateWtPath: vi.fn(),
    wslOpenedWtRef: { current: [] },
    activeWslWorktreePathRef: { current: null },
    setWslWorktreePath: vi.fn(),
    setWslWtBranch: vi.fn(),
    remoteOpenedWtRef: { current: [] },
    activeRemoteWorktreePathRef: { current: null },
    setRemoteWorktreePath: vi.fn(),
    setRemoteWtBranch: vi.fn(),
    isTerminalViewRef: { current: true },
    activeProjectRef: { current: null },
    handleOpenIde: vi.fn(),
    ...overrides,
  };
}

function dispatchKey(code: string, opts: { ctrlKey?: boolean; altKey?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', {
    code,
    ctrlKey: opts.ctrlKey ?? false,
    altKey: opts.altKey ?? false,
    bubbles: true,
  });
  // preventDefault spy
  const preventSpy = vi.spyOn(event, 'preventDefault');
  window.dispatchEvent(event);
  return { event, preventSpy };
}

describe('useKeyboardShortcuts', () => {
  let params: ReturnType<typeof createDefaultParams>;

  beforeEach(() => {
    params = createDefaultParams();
  });

  it('注册后不崩溃', () => {
    expect(() => {
      renderHook(() => useKeyboardShortcuts(params));
    }).not.toThrow();
  });

  it('Ctrl+Alt+T 在 terminal 视图中打开 side terminal', () => {
    params.isTerminalViewRef.current = true;
    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyT', { ctrlKey: true, altKey: true });

    expect(params.setSideTerminalOpen).toHaveBeenCalledWith(true);
  });

  it('Ctrl+W 关闭已打开的 side terminal', () => {
    params.sideTerminalOpenRef.current = true;
    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyW', { ctrlKey: true });

    expect(params.setSideTerminalOpen).toHaveBeenCalledWith(false);
  });

  it('Ctrl+W 不关闭未打开的 side terminal', () => {
    params.sideTerminalOpenRef.current = false;
    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyW', { ctrlKey: true });

    expect(params.setSideTerminalOpen).not.toHaveBeenCalled();
  });

  it('Ctrl+O 触发 handleOpenIde', () => {
    params.activeProjectRef.current = { id: 'p1', selected_ide: 'code' };
    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyO', { ctrlKey: true });

    expect(params.handleOpenIde).toHaveBeenCalledWith({ id: 'p1', selected_ide: 'code' });
  });

  it('Ctrl+O 不触发当无活跃项目', () => {
    params.activeProjectRef.current = null;
    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyO', { ctrlKey: true });

    expect(params.handleOpenIde).not.toHaveBeenCalled();
  });

  it('Ctrl+N 循环 worktree', () => {
    params.isTerminalViewRef.current = true;
    params.openedWorktreesRef.current = [
      { path: '/wt1', branch: 'main' },
      { path: '/wt2', branch: 'develop' },
    ];
    params.activeWorktreePathRef.current = null;

    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyN', { ctrlKey: true });

    expect(params.updateWtPath).toHaveBeenCalledWith('/wt1', 'main');
  });

  it('Ctrl+N 在最后一个 worktree 后回到 null', () => {
    params.isTerminalViewRef.current = true;
    params.openedWorktreesRef.current = [
      { path: '/wt1', branch: 'main' },
      { path: '/wt2', branch: 'develop' },
    ];
    params.activeWorktreePathRef.current = '/wt2';

    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyN', { ctrlKey: true });

    expect(params.updateWtPath).toHaveBeenCalledWith(null, '');
  });

  it('Ctrl+N 无 worktree 时不崩溃', () => {
    params.isTerminalViewRef.current = true;
    params.openedWorktreesRef.current = [];

    renderHook(() => useKeyboardShortcuts(params));

    expect(() => {
      dispatchKey('KeyN', { ctrlKey: true });
    }).not.toThrow();
  });

  it('Ctrl+Q 循环到下一个项目', () => {
    params.projects = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
    params.activeProjectId = 'p1';

    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyQ', { ctrlKey: true });

    expect(params.selectProjectRef.current).toHaveBeenCalledWith('p2');
  });

  it('Ctrl+Q 在最后一个项目后回到第一个', () => {
    params.projects = [{ id: 'p1' }, { id: 'p2' }];
    params.activeProjectId = 'p2';

    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyQ', { ctrlKey: true });

    expect(params.selectProjectRef.current).toHaveBeenCalledWith('p1');
  });

  it('Ctrl+数字键切换到对应项目', () => {
    params.projects = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];

    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('Digit2', { ctrlKey: true });

    expect(params.selectProjectRef.current).toHaveBeenCalledWith('p2');
  });

  it('Ctrl+数字键超出范围时不崩溃', () => {
    params.projects = [{ id: 'p1' }];

    renderHook(() => useKeyboardShortcuts(params));

    expect(() => {
      dispatchKey('Digit9', { ctrlKey: true });
    }).not.toThrow();
    expect(params.selectProjectRef.current).not.toHaveBeenCalled();
  });

  it('普通按键不触发快捷键', () => {
    params.isTerminalViewRef.current = true;
    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyT'); // 无 Ctrl/Alt

    expect(params.setSideTerminalOpen).not.toHaveBeenCalled();
  });
});

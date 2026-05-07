import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useAppStore } from '../../store/appStore';
import { createProject } from '../../testing/factories';

// mock terminal refresh functions
vi.mock('../../components/terminal', () => ({
  refreshTerminal: vi.fn(),
  refreshWslTerminal: vi.fn(),
  refreshRemoteTerminal: vi.fn(),
  terminalCacheKey: (projectId: string, tabId?: string | null) =>
    tabId ? `${projectId}:${tabId}:p1` : `${projectId}:p1`,
}));

function createDefaultParams() {
  return {
    updateWtPath: vi.fn(),
    setWslWorktreePath: vi.fn(),
    setWslWtBranch: vi.fn(),
    setRemoteWorktreePath: vi.fn(),
    setRemoteWtBranch: vi.fn(),
    activeTabId: null as string | null,
    onCloseTab: vi.fn(),
    shortcuts: {} as Record<string, string>,
    onToggleTerminal: vi.fn(),
  };
}

function seedStore(overrides: Partial<ReturnType<typeof useAppStore.getState>> = {}) {
  const defaults = {
    projects: [],
    activeProjectId: null,
    activeProject: null,
    isTerminalView: true,
    wslEntries: [],
    activeWslKey: null,
    remoteEntries: [],
    activeRemoteKey: null,
    activeWorktreePath: null,
    openedWorktrees: [],
    wslOpenedWt: [],
    activeWslWorktreePath: null,
    remoteOpenedWt: [],
    activeRemoteWorktreePath: null,
    worktreeState: {},
    selectProject: vi.fn(),
    selectWslProject: vi.fn(),
    selectRemoteProject: vi.fn(),
    openIde: vi.fn(),
    toggleFileView: vi.fn(),
  };
  const state = { ...defaults, ...overrides };
  useAppStore.setState(state);
  return state;
}

function dispatchKey(code: string, opts: { ctrlKey?: boolean; altKey?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', {
    code,
    ctrlKey: opts.ctrlKey ?? false,
    altKey: opts.altKey ?? false,
    bubbles: true,
  });
  const preventSpy = vi.spyOn(event, 'preventDefault');
  window.dispatchEvent(event);
  return { event, preventSpy };
}

describe('useKeyboardShortcuts', () => {
  let params: ReturnType<typeof createDefaultParams>;
  let storeState: ReturnType<typeof seedStore>;

  beforeEach(() => {
    params = createDefaultParams();
    storeState = seedStore();
  });

  it('注册后不崩溃', () => {
    expect(() => {
      renderHook(() => useKeyboardShortcuts(params));
    }).not.toThrow();
  });

  it('Ctrl+O 触发 handleOpenIde', () => {
    storeState = seedStore({
      ...storeState,
      activeProject: {
        id: 'p1',
        name: 'p1',
        path: '/tmp/p1',
        git_info: null,
        terminal: { id: 't1', pid: null, status: 'Idle', history: [], agent: null },
        selected_agent: null,
        selected_ide: 'code',
        active_view: 'Terminal',
        collapsed: true,
      },
    });
    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyO', { ctrlKey: true });

    expect(storeState.openIde).toHaveBeenCalledWith({ id: 'p1', selected_ide: 'code' });
  });

  it('Ctrl+O 不触发当无活跃项目', () => {
    storeState = seedStore({ ...storeState, activeProject: null });
    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyO', { ctrlKey: true });

    expect(storeState.openIde).not.toHaveBeenCalled();
  });

  it('Ctrl+N 循环 worktree', () => {
    storeState = seedStore({
      ...storeState,
      isTerminalView: true,
      openedWorktrees: [
        { path: '/wt1', branch: 'main' },
        { path: '/wt2', branch: 'develop' },
      ],
      activeWorktreePath: null,
    });

    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyN', { ctrlKey: true });

    expect(params.updateWtPath).toHaveBeenCalledWith('/wt1', 'main');
  });

  it('Ctrl+N 在最后一个 worktree 后回到 null', () => {
    storeState = seedStore({
      ...storeState,
      isTerminalView: true,
      openedWorktrees: [
        { path: '/wt1', branch: 'main' },
        { path: '/wt2', branch: 'develop' },
      ],
      activeWorktreePath: '/wt2',
    });

    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyN', { ctrlKey: true });

    expect(params.updateWtPath).toHaveBeenCalledWith(null, '');
  });

  it('Ctrl+N 无 worktree 时不崩溃', () => {
    storeState = seedStore({ ...storeState, isTerminalView: true, openedWorktrees: [] });

    renderHook(() => useKeyboardShortcuts(params));

    expect(() => {
      dispatchKey('KeyN', { ctrlKey: true });
    }).not.toThrow();
  });

  it('Ctrl+Q 循环到下一个项目', () => {
    storeState = seedStore({
      ...storeState,
      projects: [createProject({ id: 'p1' }), createProject({ id: 'p2' }), createProject({ id: 'p3' })],
      activeProjectId: 'p1',
    });

    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyQ', { ctrlKey: true });

    expect(storeState.selectProject).toHaveBeenCalledWith('p2');
  });

  it('Ctrl+Q 在最后一个项目后回到第一个', () => {
    storeState = seedStore({
      ...storeState,
      projects: [createProject({ id: 'p1' }), createProject({ id: 'p2' })],
      activeProjectId: 'p2',
    });

    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyQ', { ctrlKey: true });

    expect(storeState.selectProject).toHaveBeenCalledWith('p1');
  });

  it('Ctrl+数字键切换到对应项目', () => {
    storeState = seedStore({
      ...storeState,
      projects: [createProject({ id: 'p1' }), createProject({ id: 'p2' }), createProject({ id: 'p3' })],
    });

    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('Digit2', { ctrlKey: true });

    expect(storeState.selectProject).toHaveBeenCalledWith('p2');
  });

  it('Ctrl+数字键超出范围时不崩溃', () => {
    storeState = seedStore({ ...storeState, projects: [createProject({ id: 'p1' })] });

    renderHook(() => useKeyboardShortcuts(params));

    expect(() => {
      dispatchKey('Digit9', { ctrlKey: true });
    }).not.toThrow();
    expect(storeState.selectProject).not.toHaveBeenCalled();
  });

  it('普通按键不触发快捷键', () => {
    storeState = seedStore({ ...storeState, isTerminalView: true });
    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyT');

    expect(storeState.selectProject).not.toHaveBeenCalled();
  });

  it('Ctrl+W 关闭当前活跃 tab', () => {
    params.activeTabId = 't1';
    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyW', { ctrlKey: true });

    expect(params.onCloseTab).toHaveBeenCalledWith('t1');
  });

  it('Ctrl+W 无活跃 tab 时不崩溃', () => {
    params.activeTabId = null;
    renderHook(() => useKeyboardShortcuts(params));

    expect(() => {
      dispatchKey('KeyW', { ctrlKey: true });
    }).not.toThrow();
    expect(params.onCloseTab).not.toHaveBeenCalled();
  });

  it('Ctrl+Alt+R 刷新当前 tab 终端', async () => {
    const { refreshTerminal } = await import('../../components/terminal');
    params.activeTabId = 'tab1';
    storeState = seedStore({
      ...storeState,
      activeProjectId: 'p1',
      isTerminalView: true,
      activeProject: createProject({ id: 'p1' }),
    });
    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyR', { ctrlKey: true, altKey: true });

    expect(refreshTerminal).toHaveBeenCalledWith('p1:tab1:p1');
  });

  it('Ctrl+Alt+R 无活跃 tab 时刷新项目终端', async () => {
    const { refreshTerminal } = await import('../../components/terminal');
    params.activeTabId = null;
    storeState = seedStore({
      ...storeState,
      activeProjectId: 'p1',
      isTerminalView: true,
      activeProject: createProject({ id: 'p1' }),
    });
    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyR', { ctrlKey: true, altKey: true });

    expect(refreshTerminal).toHaveBeenCalledWith('p1:p1');
  });
});

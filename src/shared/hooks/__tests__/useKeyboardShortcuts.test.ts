import { renderHook } from '@testing-library/react';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

// eslint-disable-next-line import/no-restricted-paths -- tests seed the MRU store for Ctrl+Tab
import { useMruTabsStore } from '@/features/quick-open/store/mruTabsStore';
// eslint-disable-next-line import/no-restricted-paths -- tests assert the quick-open palette stays closed
import { useQuickOpenStore } from '@/features/quick-open/store/quickOpenStore';
import { useKeyboardShortcuts } from '@/shared/hooks/useKeyboardShortcuts';
import { useConnectionStore } from '@/shared/store/connectionStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import { createProject } from '@/testing/factories';

// mock terminal refresh functions
vi.mock('@/features/terminal/components/terminalCache', () => ({
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
    unifiedItems: [] as {
      kind: string;
      id: string;
      name: string;
      path: string;
      has_git_info: boolean;
      isLast: boolean;
      isFirstInSection: boolean;
    }[],
  };
}

function seedStore(overrides: Record<string, unknown> = {}) {
  const projectDefaults = {
    projects: [] as unknown[],
    activeProjectId: null as string | null,
    activeProject: null as unknown,
    isTerminalView: true,
    selectProject: vi.fn(),
    openIde: vi.fn(),
  };
  const connectionDefaults = {
    wslEntries: [] as unknown[],
    activeWslKey: null as string | null,
    remoteEntries: [] as unknown[],
    activeRemoteKey: null as unknown,
    selectWslProject: vi.fn(),
    selectRemoteProject: vi.fn(),
  };
  const worktreeDefaults = {
    activeWorktreePath: null as string | null,
    activeWorktreeBranch: '',
    openedWorktrees: [] as unknown[],
    worktreeStateMap: {} as Record<string, unknown>,
  };

  // Apply overrides to matching fields
  for (const [key, value] of Object.entries(overrides)) {
    if (key in projectDefaults) (projectDefaults as Record<string, unknown>)[key] = value;
    if (key in connectionDefaults) (connectionDefaults as Record<string, unknown>)[key] = value;
    if (key in worktreeDefaults) (worktreeDefaults as Record<string, unknown>)[key] = value;
  }

  useProjectStore.setState(projectDefaults);
  useConnectionStore.setState(connectionDefaults);
  useWorktreeStore.setState(worktreeDefaults);

  return { ...projectDefaults, ...connectionDefaults, ...worktreeDefaults };
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

/** Seed an editor store with two file tabs (t0 / t1) where t1 is active. */
function seedTwoTabEditor() {
  useEditorStore.setState({
    tabs: {
      p1: {
        tabs: [
          {
            id: 't0',
            projectId: 'p1',
            title: 'a',
            order: 0,
            data: {
              kind: 'file',
              filePath: 'a.ts',
              fileName: 'a.ts',
              content: { path: 'a.ts', content: '', size: 0, is_binary: false },
              isDirty: false,
            },
          },
          {
            id: 't1',
            projectId: 'p1',
            title: 'b',
            order: 1,
            data: {
              kind: 'file',
              filePath: 'b.ts',
              fileName: 'b.ts',
              content: { path: 'b.ts', content: '', size: 0, is_binary: false },
              isDirty: false,
            },
          },
        ],
        activeTabId: 't1',
      },
    },
    editorLayout: {
      p1: {
        isSplit: false,
        ratio: 0.5,
        activeGroupId: 'left',
        pinnedTabIds: [],
        pinnedActiveTabId: null,
        pinnedPanelRatio: 0.35,
        groups: {
          left: { tabIds: ['t0', 't1'], activeTabId: 't1' },
          right: { tabIds: [], activeTabId: null },
        },
      },
    },
  });
  seedStore({
    activeProjectId: 'p1',
    activeProject: createProject({ id: 'p1' }),
  });
}

/** Dispatch a keydown whose target is `target` (as if focus were there). */
function dispatchKeyAt(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'target', { value: target });
  window.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcuts', () => {
  let params: ReturnType<typeof createDefaultParams>;
  let storeState: ReturnType<typeof seedStore>;

  beforeEach(() => {
    params = createDefaultParams();
    storeState = seedStore();
    useMruTabsStore.setState({ byTabKey: {} });
    useQuickOpenStore.setState({ open: false, mode: 'gotoFile' });
  });

  afterEach(() => {
    // Remove any nodes leaked by failed/partial tests so the global keydown
    // handler's document.querySelector guards stay clean between tests.
    document
      .querySelectorAll('[data-quick-open], [data-modal], [data-settings-view], .cm-editor')
      .forEach((el) => el.remove());
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
        selected_agents: [],
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
      activeProjectId: 'p1',
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
      activeProjectId: 'p1',
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
    storeState = seedStore({
      ...storeState,
      activeProjectId: 'p1',
      isTerminalView: true,
      openedWorktrees: [],
    });

    renderHook(() => useKeyboardShortcuts(params));

    expect(() => {
      dispatchKey('KeyN', { ctrlKey: true });
    }).not.toThrow();
  });

  it('Ctrl+Q 循环到下一个项目', () => {
    storeState = seedStore({
      ...storeState,
      projects: [
        createProject({ id: 'p1' }),
        createProject({ id: 'p2' }),
        createProject({ id: 'p3' }),
      ],
      activeProjectId: 'p1',
    });
    const params = {
      ...createDefaultParams(),
      unifiedItems: [
        {
          kind: 'local',
          id: 'p1',
          name: 'p1',
          path: '/tmp/p1',
          has_git_info: false,
          isLast: false,
          isFirstInSection: true,
        },
        {
          kind: 'local',
          id: 'p2',
          name: 'p2',
          path: '/tmp/p2',
          has_git_info: false,
          isLast: false,
          isFirstInSection: false,
        },
        {
          kind: 'local',
          id: 'p3',
          name: 'p3',
          path: '/tmp/p3',
          has_git_info: false,
          isLast: true,
          isFirstInSection: false,
        },
      ],
    };

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
    const params = {
      ...createDefaultParams(),
      unifiedItems: [
        {
          kind: 'local',
          id: 'p1',
          name: 'p1',
          path: '/tmp/p1',
          has_git_info: false,
          isLast: false,
          isFirstInSection: true,
        },
        {
          kind: 'local',
          id: 'p2',
          name: 'p2',
          path: '/tmp/p2',
          has_git_info: false,
          isLast: true,
          isFirstInSection: false,
        },
      ],
    };

    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('KeyQ', { ctrlKey: true });

    expect(storeState.selectProject).toHaveBeenCalledWith('p1');
  });

  it('Ctrl+数字键切换到对应项目', () => {
    storeState = seedStore({
      ...storeState,
      projects: [
        createProject({ id: 'p1' }),
        createProject({ id: 'p2' }),
        createProject({ id: 'p3' }),
      ],
    });
    const params = {
      ...createDefaultParams(),
      unifiedItems: [
        {
          kind: 'local',
          id: 'p1',
          name: 'p1',
          path: '/tmp/p1',
          has_git_info: false,
          isLast: false,
          isFirstInSection: true,
        },
        {
          kind: 'local',
          id: 'p2',
          name: 'p2',
          path: '/tmp/p2',
          has_git_info: false,
          isLast: false,
          isFirstInSection: false,
        },
        {
          kind: 'local',
          id: 'p3',
          name: 'p3',
          path: '/tmp/p3',
          has_git_info: false,
          isLast: true,
          isFirstInSection: false,
        },
      ],
    };

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

  it('输入框聚焦时不触发 Ctrl+W', () => {
    params.activeTabId = 't1';
    renderHook(() => useKeyboardShortcuts(params));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      code: 'KeyW',
      key: 'w',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: input });
    window.dispatchEvent(event);

    expect(params.onCloseTab).not.toHaveBeenCalled();
    input.remove();
  });

  it('CodeMirror 聚焦时仍触发 Ctrl+W 关闭 tab', () => {
    params.activeTabId = 't1';
    renderHook(() => useKeyboardShortcuts(params));

    const cm = document.createElement('div');
    cm.className = 'cm-editor';
    const content = document.createElement('div');
    content.className = 'cm-content';
    content.contentEditable = 'true';
    content.setAttribute('role', 'textbox');
    cm.appendChild(content);
    document.body.appendChild(cm);

    const event = new KeyboardEvent('keydown', {
      code: 'KeyW',
      key: 'w',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: content });
    window.dispatchEvent(event);

    expect(params.onCloseTab).toHaveBeenCalledWith('t1');
    cm.remove();
  });

  it('绑定 Alt+Left 后，CodeMirror 聚焦时切换到上一个 tab', () => {
    params.activeTabId = 't1';
    params.shortcuts = { prevTab: 'Alt+Left' };
    seedTwoTabEditor();
    renderHook(() => useKeyboardShortcuts(params));

    const cm = document.createElement('div');
    cm.className = 'cm-editor';
    const content = document.createElement('div');
    content.className = 'cm-content';
    content.contentEditable = 'true';
    content.setAttribute('role', 'textbox');
    cm.appendChild(content);
    document.body.appendChild(cm);

    dispatchKeyAt(content, { code: 'ArrowLeft', key: 'ArrowLeft', altKey: true });

    expect(useEditorStore.getState().tabs.p1?.activeTabId).toBe('t0');
    cm.remove();
  });

  it('绑定 Alt+Left 后，终端 textarea 聚焦时切换到上一个 tab（并阻止事件泄漏到 xterm）', () => {
    params.activeTabId = 't1';
    params.shortcuts = { prevTab: 'Alt+Left' };
    seedTwoTabEditor();
    renderHook(() => useKeyboardShortcuts(params));

    // xterm.js 的隐藏辅助 textarea 是终端聚焦时的真实目标。
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    const event = new KeyboardEvent('keydown', {
      code: 'ArrowLeft',
      key: 'ArrowLeft',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: textarea });
    const stopSpy = vi.spyOn(event, 'stopPropagation');
    window.dispatchEvent(event);

    expect(useEditorStore.getState().tabs.p1?.activeTabId).toBe('t0');
    // 阻止事件继续到达 xterm，避免同时向 shell 发送转义序列。
    expect(stopSpy).toHaveBeenCalled();
    textarea.remove();
  });

  it('默认未绑定 Alt+Left 时不切换 tab（保留 macOS Option+方向键按词移动语义）', () => {
    params.activeTabId = 't1';
    seedTwoTabEditor();
    renderHook(() => useKeyboardShortcuts(params));

    const cm = document.createElement('div');
    cm.className = 'cm-editor';
    const content = document.createElement('div');
    content.className = 'cm-content';
    cm.appendChild(content);
    document.body.appendChild(cm);

    dispatchKeyAt(content, { code: 'ArrowLeft', key: 'ArrowLeft', altKey: true });

    expect(useEditorStore.getState().tabs.p1?.activeTabId).toBe('t1');
    cm.remove();
  });

  it('Ctrl+Tab 切换到 MRU 上一个 tab，且不打开 QuickOpen 面板', () => {
    params.activeTabId = 't1';
    useMruTabsStore.setState({ byTabKey: { p1: ['t0'] } });
    seedTwoTabEditor(); // t0 / t1, active t1
    renderHook(() => useKeyboardShortcuts(params));

    dispatchKey('Tab', { ctrlKey: true });

    expect(useEditorStore.getState().tabs.p1?.activeTabId).toBe('t0');
    expect(useQuickOpenStore.getState().open).toBe(false);
  });

  it('QuickOpen 面板打开时 Ctrl+Tab 不触发 tab 切换', () => {
    params.activeTabId = 't1';
    useMruTabsStore.setState({ byTabKey: { p1: ['t0'] } });
    seedTwoTabEditor();
    renderHook(() => useKeyboardShortcuts(params));

    const root = document.createElement('div');
    root.setAttribute('data-quick-open', '');
    document.body.appendChild(root);

    dispatchKey('Tab', { ctrlKey: true });

    expect(useEditorStore.getState().tabs.p1?.activeTabId).toBe('t1');
    expect(useQuickOpenStore.getState().mode).toBe('gotoFile');
    root.remove();
  });

  it('设置页打开时不触发快捷键', () => {
    params.activeTabId = 't1';
    renderHook(() => useKeyboardShortcuts(params));

    const root = document.createElement('div');
    root.setAttribute('data-settings-view', '');
    document.body.appendChild(root);

    dispatchKey('KeyW', { ctrlKey: true });

    expect(params.onCloseTab).not.toHaveBeenCalled();
    root.remove();
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
    // eslint-disable-next-line import/no-restricted-paths -- test uses terminal cache for mock
    const { refreshTerminal } = await import('@/features/terminal/components/terminalCache');
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
    // eslint-disable-next-line import/no-restricted-paths -- test uses terminal cache for mock
    const { refreshTerminal } = await import('@/features/terminal/components/terminalCache');
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

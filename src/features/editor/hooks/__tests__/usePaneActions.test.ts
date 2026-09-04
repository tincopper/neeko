// Unit tests for usePaneActions: tab operations + Action Menu execution
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the terminal module before importing the hook
vi.mock('@/features/terminal', () => ({
  closeEditorTab: vi.fn(),
}));

import type { ActionRegistryItem } from '@/features/action-menu/types/actionMenu';
import { useCloseConfirmStore } from '@/features/editor/store/closeConfirmStore';
import { closeEditorTab } from '@/features/terminal';
import { useEditorStore } from '@/shared/store/editorStore';
import { useOverlayStore } from '@/shared/store/overlayStore';
import type { AgentConfig, FileTabData, Tab } from '@/shared/types';

import { usePaneActions } from '../usePaneActions';

function makeFileTab(id: string, overrides: Partial<FileTabData> = {}): Tab {
  return {
    id,
    projectId: 'p1',
    title: id,
    order: 0,
    data: {
      kind: 'file',
      filePath: id,
      fileName: id,
      content: { path: id, content: '', size: 0, is_binary: false },
      isDirty: false,
      ...overrides,
    },
  };
}

describe('usePaneActions', () => {
  const defaultParams = {
    tabKey: 'p1',
    groupId: 'left' as const,
    tabs: [makeFileTab('tab1'), makeFileTab('tab2')],
    projectIdForCheck: 'p1',
    agents: [{ id: 'opencode', name: 'OpenCode', enabled: true, command: 'opencode' }] as [],
    onAddTerminalTab: vi.fn(),
    onActionMenuClose: vi.fn(),
    onSaveTab: vi.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
    useCloseConfirmStore.setState({ pending: null });
    useOverlayStore.getState().reset();
    vi.clearAllMocks();
  });

  /** dirty 判断走共享 helper 的 store 查找：把 params.tabs 同步种进 editorStore。 */
  function seedTabs(tabs: Tab[]) {
    for (const tab of tabs) useEditorStore.getState().addTab('p1', tab);
  }

  it('handleActivateTab activates the tab in store', () => {
    const { result } = renderHook(() => usePaneActions(defaultParams));
    useEditorStore.getState().addTab('p1', {
      id: 'tab1',
      projectId: 'p1',
      title: 'tab1',
      order: 0,
      data: { kind: 'file', filePath: 't1', fileName: 't1', content: '', isDirty: false },
    });

    act(() => {
      result.current.handleActivateTab('tab1');
    });

    expect(useEditorStore.getState().activeTabId).toBe('tab1');
  });
  it('handleCloseTab calls closeEditorTab for non-dirty tabs without confirmation', async () => {
    seedTabs(defaultParams.tabs);
    const { result } = renderHook(() => usePaneActions(defaultParams));

    await act(async () => {
      await result.current.handleCloseTab('tab1');
    });

    expect(closeEditorTab).toHaveBeenCalledWith('p1', 'tab1');
    expect(useCloseConfirmStore.getState().pending).toBeNull();
  });

  it('handleCloseTab skips confirmation for pinned group', async () => {
    const params = { ...defaultParams, groupId: 'pinned' as const };
    seedTabs(params.tabs);
    const { result } = renderHook(() => usePaneActions(params));

    await act(async () => {
      await result.current.handleCloseTab('tab1');
    });

    expect(closeEditorTab).not.toHaveBeenCalled();
    expect(useCloseConfirmStore.getState().pending).toBeNull();
  });

  it('handleCloseTab requests confirmation for dirty untitled tabs; discard closes', async () => {
    const tabs = [
      makeFileTab('tab1', { isUntitled: true, isDirty: true, untitledName: 'Untitled-1' }),
    ];
    const params = { ...defaultParams, tabs };
    seedTabs(tabs);
    const { result } = renderHook(() => usePaneActions(params));

    let closing: Promise<void> | undefined;
    act(() => {
      closing = result.current.handleCloseTab('tab1');
    });
    expect(useCloseConfirmStore.getState().pending).toEqual({ fileName: 'Untitled-1' });

    await act(async () => {
      useCloseConfirmStore.getState().resolve('discard');
      await closing;
    });
    // 'discard' → proceed to close
    expect(closeEditorTab).toHaveBeenCalledWith('p1', 'tab1');
  });

  it('handleCloseTab requests confirmation for dirty NAMED files (not just untitled)', async () => {
    const tabs = [
      makeFileTab('tab1', { isUntitled: false, isDirty: true, fileName: 'src/index.ts' }),
    ];
    const params = { ...defaultParams, tabs };
    seedTabs(tabs);
    const { result } = renderHook(() => usePaneActions(params));

    let closing: Promise<void> | undefined;
    act(() => {
      closing = result.current.handleCloseTab('tab1');
    });
    expect(useCloseConfirmStore.getState().pending).toEqual({ fileName: 'src/index.ts' });

    await act(async () => {
      useCloseConfirmStore.getState().resolve('cancel');
      await closing;
    });
    expect(closeEditorTab).not.toHaveBeenCalled();
  });

  it('handleCloseTab aborts when user cancels confirmation', async () => {
    const tabs = [makeFileTab('tab1', { isUntitled: true, isDirty: true })];
    const params = { ...defaultParams, tabs };
    seedTabs(tabs);
    const { result } = renderHook(() => usePaneActions(params));

    let closing: Promise<void> | undefined;
    act(() => {
      closing = result.current.handleCloseTab('tab1');
    });

    await act(async () => {
      useCloseConfirmStore.getState().resolve('cancel');
      await closing;
    });
    expect(closeEditorTab).not.toHaveBeenCalled();
  });

  it('handleCloseTab saves the tab first when user chooses save', async () => {
    const tabs = [makeFileTab('tab1', { isDirty: true, fileName: 'a.ts' })];
    const onSaveTab = vi.fn().mockResolvedValue(true);
    const params = { ...defaultParams, tabs, onSaveTab };
    seedTabs(tabs);
    const { result } = renderHook(() => usePaneActions(params));

    let closing: Promise<void> | undefined;
    act(() => {
      closing = result.current.handleCloseTab('tab1');
    });

    await act(async () => {
      useCloseConfirmStore.getState().resolve('save');
      await closing;
    });

    expect(onSaveTab).toHaveBeenCalledWith('tab1');
    expect(closeEditorTab).toHaveBeenCalledWith('p1', 'tab1');
  });

  it('handleCloseTab aborts close when save fails', async () => {
    const tabs = [makeFileTab('tab1', { isDirty: true, fileName: 'a.ts' })];
    const onSaveTab = vi.fn().mockResolvedValue(false);
    const params = { ...defaultParams, tabs, onSaveTab };
    seedTabs(tabs);
    const { result } = renderHook(() => usePaneActions(params));

    let closing: Promise<void> | undefined;
    act(() => {
      closing = result.current.handleCloseTab('tab1');
    });

    await act(async () => {
      useCloseConfirmStore.getState().resolve('save');
      await closing;
    });

    expect(onSaveTab).toHaveBeenCalledWith('tab1');
    expect(closeEditorTab).not.toHaveBeenCalled();
  });
  it('handleActionMenuExecute: new-terminal calls onAddTerminalTab', () => {
    const { result } = renderHook(() => usePaneActions(defaultParams));

    act(() => {
      result.current.handleActionMenuExecute({
        id: 'new-terminal',
      } as unknown as ActionRegistryItem);
    });

    expect(defaultParams.onAddTerminalTab).toHaveBeenCalled();
  });

  it('handleActionMenuExecute: new-file creates untitled tab', () => {
    const { result } = renderHook(() => usePaneActions(defaultParams));

    act(() => {
      result.current.handleActionMenuExecute({ id: 'new-file' } as unknown as ActionRegistryItem);
    });

    const s = useEditorStore.getState();
    const tabs = s.tabs['p1']?.tabs ?? [];
    expect(tabs.length).toBe(1);
    expect(tabs[0]?.data.kind).toBe('file');
  });

  it('handleActionMenuAgentTerminal creates agent terminal tab', () => {
    const { result } = renderHook(() => usePaneActions(defaultParams));

    act(() => {
      result.current.handleActionMenuAgentTerminal('opencode', 'OpenCode');
    });

    const s = useEditorStore.getState();
    const tabs = s.tabs['p1']?.tabs ?? [];
    expect(tabs.length).toBe(1);
    expect(tabs[0]?.data).toMatchObject({ kind: 'terminal', agentId: 'opencode' });
  });

  it('handleNewFileTab creates untitled file tab', () => {
    const { result } = renderHook(() => usePaneActions(defaultParams));

    act(() => {
      result.current.handleNewFileTab();
    });

    const s = useEditorStore.getState();
    const tabs = s.tabs['p1']?.tabs ?? [];
    expect(tabs.length).toBe(1);
  });

  it('handleActionMenuExecute: new-browser creates a browser tab and activates it', () => {
    const { result } = renderHook(() => usePaneActions(defaultParams));

    act(() => {
      result.current.handleActionMenuExecute({
        id: 'new-browser',
      } as unknown as ActionRegistryItem);
    });

    const s = useEditorStore.getState();
    const tabs = s.tabs['p1']?.tabs ?? [];
    expect(tabs.length).toBe(1);
    expect(tabs[0]?.data).toMatchObject({ kind: 'browser', url: '' });
    expect(s.activeTabId).toBe(tabs[0]?.id);
  });

  it('handleActionMenuExecute: new-browser is a no-op without a project', () => {
    const params = { ...defaultParams, projectIdForCheck: null };
    const { result } = renderHook(() => usePaneActions(params));

    act(() => {
      result.current.handleActionMenuExecute({
        id: 'new-browser',
      } as unknown as ActionRegistryItem);
    });

    expect(useEditorStore.getState().tabs['p1']).toBeUndefined();
  });
});

describe('usePaneActions — pinned pane 内创建跟随落组', () => {
  function setup(groupId: 'pinned') {
    const onAddTerminalTab = vi.fn();
    const params = {
      tabKey: 'p1',
      groupId,
      tabs: [makeFileTab('tab1')],
      projectIdForCheck: 'p1',
      agents: [
        { id: 'opencode', name: 'OpenCode', enabled: true, command: 'opencode' },
      ] as unknown as AgentConfig[],
      onAddTerminalTab,
      onActionMenuClose: vi.fn(),
    };
    return { params, onAddTerminalTab };
  }

  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
  });

  it('new-agent-chat → 落 pinned 组（pinnedTabIds 追加）', () => {
    const { params } = setup('pinned');
    const { result } = renderHook(() => usePaneActions(params));

    act(() => {
      result.current.handleActionMenuExecute({
        id: 'new-agent-chat',
      } as unknown as ActionRegistryItem);
    });

    const layout = useEditorStore.getState().editorLayout['p1'];
    expect(layout?.pinnedTabIds).toHaveLength(1);
    expect(layout?.groups.left.tabIds).toEqual([]);
  });

  it('new-browser → 落 pinned 组', () => {
    const { params } = setup('pinned');
    const { result } = renderHook(() => usePaneActions(params));

    act(() => {
      result.current.handleActionMenuExecute({
        id: 'new-browser',
      } as unknown as ActionRegistryItem);
    });

    const layout = useEditorStore.getState().editorLayout['p1'];
    expect(layout?.pinnedTabIds).toHaveLength(1);
  });

  it("new-terminal → onAddTerminalTab 收到 'pinned'", () => {
    const { params, onAddTerminalTab } = setup('pinned');
    const { result } = renderHook(() => usePaneActions(params));

    act(() => {
      result.current.handleActionMenuExecute({
        id: 'new-terminal',
      } as unknown as ActionRegistryItem);
    });

    expect(onAddTerminalTab).toHaveBeenCalledWith('pinned');
  });
});

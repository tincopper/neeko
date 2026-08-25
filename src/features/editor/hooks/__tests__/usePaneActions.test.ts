// Unit tests for usePaneActions: tab operations + Action Menu execution
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the terminal module before importing the hook
vi.mock('@/features/terminal', () => ({
  closeEditorTab: vi.fn(),
}));

import { closeEditorTab } from '@/features/terminal';
import { useEditorStore } from '@/shared/store/editorStore';
import type { FileTabData, Tab } from '@/shared/types';

import { usePaneActions } from '../usePaneActions';

type CloseAction = 'save' | 'discard' | 'cancel';

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
    onRequestCloseTab: vi.fn().mockResolvedValue('discard' as CloseAction),
    onSaveTab: vi.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
    vi.clearAllMocks();
  });

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

  it('handleCloseTab calls closeEditorTab for non-dirty tabs', async () => {
    const { result } = renderHook(() => usePaneActions(defaultParams));

    await act(async () => {
      await result.current.handleCloseTab('tab1');
    });

    expect(closeEditorTab).toHaveBeenCalledWith('p1', 'tab1');
    expect(defaultParams.onRequestCloseTab).not.toHaveBeenCalled();
  });

  it('handleCloseTab skips confirmation for pinned group', async () => {
    const params = { ...defaultParams, groupId: 'pinned' as const };
    const { result } = renderHook(() => usePaneActions(params));

    await act(async () => {
      await result.current.handleCloseTab('tab1');
    });

    expect(closeEditorTab).not.toHaveBeenCalled();
  });

  it('handleCloseTab requests confirmation for dirty untitled tabs', async () => {
    const tabs = [
      makeFileTab('tab1', { isUntitled: true, isDirty: true, untitledName: 'Untitled-1' }),
    ];
    const params = { ...defaultParams, tabs };
    const { result } = renderHook(() => usePaneActions(params));

    await act(async () => {
      await result.current.handleCloseTab('tab1');
    });

    expect(defaultParams.onRequestCloseTab).toHaveBeenCalledWith('tab1', 'Untitled-1');
    // 'discard' → proceed to close
    expect(closeEditorTab).toHaveBeenCalledWith('p1', 'tab1');
  });

  it('handleCloseTab requests confirmation for dirty NAMED files (not just untitled)', async () => {
    const tabs = [
      makeFileTab('tab1', { isUntitled: false, isDirty: true, fileName: 'src/index.ts' }),
    ];
    const params = { ...defaultParams, tabs };
    const { result } = renderHook(() => usePaneActions(params));

    await act(async () => {
      await result.current.handleCloseTab('tab1');
    });

    expect(defaultParams.onRequestCloseTab).toHaveBeenCalledWith('tab1', 'src/index.ts');
  });

  it('handleCloseTab aborts when user cancels confirmation', async () => {
    const tabs = [makeFileTab('tab1', { isUntitled: true, isDirty: true })];
    const onRequestCloseTab = vi.fn().mockResolvedValue('cancel' as CloseAction);
    const params = { ...defaultParams, tabs, onRequestCloseTab };
    const { result } = renderHook(() => usePaneActions(params));

    await act(async () => {
      await result.current.handleCloseTab('tab1');
    });

    expect(onRequestCloseTab).toHaveBeenCalled();
    expect(closeEditorTab).not.toHaveBeenCalled();
  });

  it('handleCloseTab saves the tab first when user chooses save', async () => {
    const tabs = [makeFileTab('tab1', { isDirty: true, fileName: 'a.ts' })];
    const onRequestCloseTab = vi.fn().mockResolvedValue('save' as CloseAction);
    const onSaveTab = vi.fn().mockResolvedValue(true);
    const params = { ...defaultParams, tabs, onRequestCloseTab, onSaveTab };
    const { result } = renderHook(() => usePaneActions(params));

    await act(async () => {
      await result.current.handleCloseTab('tab1');
    });

    expect(onSaveTab).toHaveBeenCalledWith('tab1');
    expect(closeEditorTab).toHaveBeenCalledWith('p1', 'tab1');
  });

  it('handleCloseTab aborts close when save fails', async () => {
    const tabs = [makeFileTab('tab1', { isDirty: true, fileName: 'a.ts' })];
    const onRequestCloseTab = vi.fn().mockResolvedValue('save' as CloseAction);
    const onSaveTab = vi.fn().mockResolvedValue(false);
    const params = { ...defaultParams, tabs, onRequestCloseTab, onSaveTab };
    const { result } = renderHook(() => usePaneActions(params));

    await act(async () => {
      await result.current.handleCloseTab('tab1');
    });

    expect(onSaveTab).toHaveBeenCalledWith('tab1');
    expect(closeEditorTab).not.toHaveBeenCalled();
  });

  it('handleCloseTab closes directly when no onRequestCloseTab provided', async () => {
    const tabs = [makeFileTab('tab1', { isDirty: true, fileName: 'a.ts' })];
    const params = { ...defaultParams, tabs, onRequestCloseTab: undefined };
    const { result } = renderHook(() => usePaneActions(params));

    await act(async () => {
      await result.current.handleCloseTab('tab1');
    });

    expect(closeEditorTab).toHaveBeenCalledWith('p1', 'tab1');
  });

  it('handleActionMenuExecute: new-terminal calls onAddTerminalTab', () => {
    const { result } = renderHook(() => usePaneActions(defaultParams));

    act(() => {
      result.current.handleActionMenuExecute({ id: 'new-terminal' } as never);
    });

    expect(defaultParams.onAddTerminalTab).toHaveBeenCalled();
  });

  it('handleActionMenuExecute: new-file creates untitled tab', () => {
    const { result } = renderHook(() => usePaneActions(defaultParams));

    act(() => {
      result.current.handleActionMenuExecute({ id: 'new-file' } as never);
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
      result.current.handleActionMenuExecute({ id: 'new-browser' } as never);
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
      result.current.handleActionMenuExecute({ id: 'new-browser' } as never);
    });

    expect(useEditorStore.getState().tabs['p1']).toBeUndefined();
  });
});

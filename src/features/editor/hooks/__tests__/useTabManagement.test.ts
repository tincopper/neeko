import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCloseConfirmStore } from '@/features/editor/store/closeConfirmStore';
import { closeEditorTab } from '@/features/terminal';
import { useEditorStore } from '@/shared/store/editorStore';
import { useOverlayStore } from '@/shared/store/overlayStore';
import type { Tab } from '@/shared/types/tab';

import { useTabManagement } from '../useTabManagement';

// 只 mock useTabManagement 实际依赖的底层模块，而非整个门面：
// 门面保持真实，未来新增门面导出不会因 mock 缺失而静默变 undefined。
vi.mock('@/features/terminal/components/terminalTabCleanup', () => ({
  closeEditorTab: vi.fn(),
  closeAllEditorTabs: vi.fn(),
}));
vi.mock('@/features/terminal/hooks/useTerminalTabs', () => ({
  useTerminalTabs: () => ({
    getTabs: () => [],
    addTab: vi.fn(),
    activateTab: vi.fn(),
    updateTabStatus: vi.fn(),
    handleAgentClick: vi.fn(),
  }),
}));

const mockCloseEditorTab = vi.mocked(closeEditorTab);

function makeTerminalTab(id: string, projectId: string, title = id): Tab {
  return {
    id,
    projectId,
    title,
    order: 0,
    data: { kind: 'terminal', agentId: null, status: 'Idle' },
  };
}

function makeFileTab(id: string, projectId: string, isDirty: boolean): Tab {
  return {
    id,
    projectId,
    title: id,
    order: 0,
    data: {
      kind: 'file',
      filePath: `${id}.ts`,
      fileName: `${id}.ts`,
      content: { path: `${id}.ts`, content: 'x', size: 1, is_binary: false },
      isDirty,
    },
  };
}

describe('useTabManagement handleCloseTab', () => {
  beforeEach(() => {
    mockCloseEditorTab.mockClear();
    useCloseConfirmStore.setState({ pending: null });
    useOverlayStore.getState().reset();
    // Seed two tabKeys so a regression to full-scan would have other keys to
    // mistakenly match against.
    useEditorStore.setState({
      tabs: {
        p1: { tabs: [makeTerminalTab('tab-1', 'p1')], activeTabId: 'tab-1' },
        p2: { tabs: [makeTerminalTab('tab-2', 'p2')], activeTabId: 'tab-2' },
      },
      activeTabId: 'tab-1',
      editorLayout: {},
    });
  });

  it('should_close_tab_via_tabKey_context_without_scanning_other_keys', async () => {
    const { result } = renderHook(() =>
      useTabManagement({
        activeProject: { id: 'p1' },
        activeWorktreePath: null,
      }),
    );

    await act(async () => {
      await result.current.handleCloseTab('tab-1');
    });

    // Must target the active tabKey only, not scan state.tabs for the tabId.
    expect(mockCloseEditorTab).toHaveBeenCalledTimes(1);
    expect(mockCloseEditorTab).toHaveBeenCalledWith('p1', 'tab-1');
  });

  it('非 dirty 文件 tab → 直关，不弹确认', async () => {
    useEditorStore.setState({
      tabs: {
        p1: { tabs: [makeFileTab('f1', 'p1', false)], activeTabId: 'f1' },
        p2: { tabs: [makeTerminalTab('tab-2', 'p2')], activeTabId: 'tab-2' },
      },
      editorLayout: {},
    });
    const saveTabById = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      useTabManagement({ activeProject: { id: 'p1' }, activeWorktreePath: null, saveTabById }),
    );

    await act(async () => {
      await result.current.handleCloseTab('f1');
    });

    expect(mockCloseEditorTab).toHaveBeenCalledWith('p1', 'f1');
    expect(saveTabById).not.toHaveBeenCalled();
    expect(useCloseConfirmStore.getState().pending).toBeNull();
  });

  it('dirty 文件 tab：cancel → 不关闭', async () => {
    useEditorStore.setState({
      tabs: {
        p1: { tabs: [makeFileTab('f1', 'p1', true)], activeTabId: 'f1' },
        p2: { tabs: [makeTerminalTab('tab-2', 'p2')], activeTabId: 'tab-2' },
      },
      editorLayout: {},
    });
    const saveTabById = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      useTabManagement({ activeProject: { id: 'p1' }, activeWorktreePath: null, saveTabById }),
    );

    let closing: Promise<void> | undefined;
    act(() => {
      closing = result.current.handleCloseTab('f1');
    });
    expect(useCloseConfirmStore.getState().pending).toEqual({ fileName: 'f1.ts' });

    await act(async () => {
      useCloseConfirmStore.getState().resolve('cancel');
      await closing;
    });

    expect(saveTabById).not.toHaveBeenCalled();
    expect(mockCloseEditorTab).not.toHaveBeenCalled();
  });

  it('dirty 文件 tab：discard → 直接关闭（不调用保存）', async () => {
    useEditorStore.setState({
      tabs: {
        p1: { tabs: [makeFileTab('f1', 'p1', true)], activeTabId: 'f1' },
        p2: { tabs: [makeTerminalTab('tab-2', 'p2')], activeTabId: 'tab-2' },
      },
      editorLayout: {},
    });
    const saveTabById = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      useTabManagement({ activeProject: { id: 'p1' }, activeWorktreePath: null, saveTabById }),
    );

    let closing: Promise<void> | undefined;
    act(() => {
      closing = result.current.handleCloseTab('f1');
    });

    await act(async () => {
      useCloseConfirmStore.getState().resolve('discard');
      await closing;
    });

    expect(saveTabById).not.toHaveBeenCalled();
    expect(mockCloseEditorTab).toHaveBeenCalledWith('p1', 'f1');
  });

  it('dirty 文件 tab：save 成功 → 先保存再关闭', async () => {
    useEditorStore.setState({
      tabs: {
        p1: { tabs: [makeFileTab('f1', 'p1', true)], activeTabId: 'f1' },
        p2: { tabs: [makeTerminalTab('tab-2', 'p2')], activeTabId: 'tab-2' },
      },
      editorLayout: {},
    });
    const saveTabById = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      useTabManagement({ activeProject: { id: 'p1' }, activeWorktreePath: null, saveTabById }),
    );

    let closing: Promise<void> | undefined;
    act(() => {
      closing = result.current.handleCloseTab('f1');
    });

    await act(async () => {
      useCloseConfirmStore.getState().resolve('save');
      await closing;
    });

    expect(saveTabById).toHaveBeenCalledWith('f1');
    expect(mockCloseEditorTab).toHaveBeenCalledWith('p1', 'f1');
  });

  it('dirty 文件 tab：save 失败 → 不关闭', async () => {
    useEditorStore.setState({
      tabs: {
        p1: { tabs: [makeFileTab('f1', 'p1', true)], activeTabId: 'f1' },
        p2: { tabs: [makeTerminalTab('tab-2', 'p2')], activeTabId: 'tab-2' },
      },
      editorLayout: {},
    });
    const saveTabById = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() =>
      useTabManagement({ activeProject: { id: 'p1' }, activeWorktreePath: null, saveTabById }),
    );

    let closing: Promise<void> | undefined;
    act(() => {
      closing = result.current.handleCloseTab('f1');
    });

    await act(async () => {
      useCloseConfirmStore.getState().resolve('save');
      await closing;
    });

    expect(saveTabById).toHaveBeenCalledWith('f1');
    expect(mockCloseEditorTab).not.toHaveBeenCalled();
  });
});

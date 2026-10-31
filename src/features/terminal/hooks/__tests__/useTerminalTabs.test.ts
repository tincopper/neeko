import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useTerminalTabs } from '@/features/terminal/hooks/useTerminalTabs';
import { activeTabIdOf, useEditorStore } from '@/shared/store/editorStore';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

vi.mock('@/features/terminal/components/terminalTabCleanup', async () => {
  const { useEditorStore } = await import('@/shared/store/editorStore');
  return {
    closeEditorTab: vi.fn((projectId: string, tabId: string) => {
      useEditorStore.getState().closeTab(projectId, tabId);
    }),
    closeAllEditorTabs: vi.fn((projectId: string) => {
      useEditorStore.getState().clearProjectTabs(projectId);
    }),
    cleanupTerminalsForTab: vi.fn(),
    cleanupTerminalsForTabKey: vi.fn(),
  };
});

describe('useTerminalTabs', () => {
  const PROJECT_ID = 'test-project';
  const SPACE = WorkspaceSession.of(PROJECT_ID, null).key;

  /**
   * 该 tab 空间的激活 tabId —— 直读 store。
   *
   * 此前断言走 `getActiveTabId`，那个 helper 自带「无激活终端则回退数组首个 terminal」
   * 的第二套口径（与 foregroundTerminalTab 的 order 升序不一致），本任务按 R4 删除它；
   * 测试要保护的是**关闭后的激活态回退**这一 store 行为，走布局派生（`activeTabIdOf`）反而更贴切。
   */
  function activeId(tabKey: string): string | null {
    return activeTabIdOf(tabKey);
  }

  beforeEach(() => {
    // Clear the unified store tabs between tests
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
  });

  it('should close the last tab and set activeTabId to null', () => {
    const { result } = renderHook(() => useTerminalTabs());

    let tabId = '';
    act(() => {
      tabId = result.current.addTab(PROJECT_ID)!.id;
    });

    expect(result.current.getTabs(SPACE)).toHaveLength(1);
    expect(activeId(SPACE)).toBe(tabId);

    act(() => {
      result.current.closeTab(SPACE, tabId);
    });

    expect(result.current.getTabs(SPACE)).toHaveLength(0);
    expect(activeId(SPACE)).toBeNull();
  });

  it('should activate adjacent tab when closing a middle tab', () => {
    const { result } = renderHook(() => useTerminalTabs());

    let tab2Id = '';
    let tab3Id = '';
    act(() => {
      result.current.addTab(PROJECT_ID);
      const tab2 = result.current.addTab(PROJECT_ID);
      tab2Id = tab2!.id;
      const tab3 = result.current.addTab(PROJECT_ID);
      tab3Id = tab3!.id;
    });

    expect(result.current.getTabs(SPACE)).toHaveLength(3);
    expect(activeId(SPACE)).toBe(tab3Id);

    act(() => {
      result.current.closeTab(SPACE, tab2Id);
    });

    expect(result.current.getTabs(SPACE)).toHaveLength(2);
    expect(activeId(SPACE)).toBe(tab3Id);
  });

  it('should switch to previous tab when closing the last tab in list', () => {
    const { result } = renderHook(() => useTerminalTabs());

    let tab1Id = '';
    let tab2Id = '';
    act(() => {
      tab1Id = result.current.addTab(PROJECT_ID)!.id;
      const tab2 = result.current.addTab(PROJECT_ID);
      tab2Id = tab2!.id;
    });

    expect(activeId(SPACE)).toBe(tab2Id);

    act(() => {
      result.current.closeTab(SPACE, tab2Id);
    });

    expect(result.current.getTabs(SPACE)).toHaveLength(1);
    expect(activeId(SPACE)).toBe(tab1Id);
  });

  describe('handleAgentClick', () => {
    it('创建新 agent tab 并返回 TerminalTab 对象', () => {
      const { result } = renderHook(() => useTerminalTabs());

      let firstTab: string | undefined;
      act(() => {
        firstTab = result.current.addTab(PROJECT_ID)!.id;
      });

      const agent = { id: 'claude-code', name: 'Claude Code', command: 'claude', args: [] };
      let created: ReturnType<typeof result.current.handleAgentClick> = null;
      act(() => {
        created = result.current.handleAgentClick(PROJECT_ID, agent);
      });

      expect(created).not.toBeNull();
      expect(result.current.getTabs(SPACE)).toHaveLength(2);
      expect(activeId(SPACE)).not.toBe(firstTab);
    });

    it('新 tab 携带正确的 agentId，标题用 agent 名占位', () => {
      const { result } = renderHook(() => useTerminalTabs());

      const agent = { id: 'cursor-agent', name: 'Cursor Agent', command: 'cursor', args: [] };
      let created: ReturnType<typeof result.current.handleAgentClick> = null;
      act(() => {
        result.current.addTab(PROJECT_ID);
        created = result.current.handleAgentClick(PROJECT_ID, agent);
      });

      expect(created).not.toBeNull();
      expect(created?.agentId).toBe('cursor-agent');
      // 会话起名前用 agent 名占位；真标题到手后由 `resolveTabTitle` 覆盖
      expect(created?.title).toBe('Cursor Agent');
    });

    it('达到 10 个 tab 上限时返回 null', () => {
      const { result } = renderHook(() => useTerminalTabs());

      // 创建 10 个终端 tab
      act(() => {
        for (let i = 0; i < 10; i++) {
          result.current.addTab(PROJECT_ID);
        }
      });

      expect(result.current.getTabs(SPACE)).toHaveLength(10);

      const agent = { id: 'claude-code', name: 'Claude Code', command: 'claude', args: [] };
      let created: ReturnType<typeof result.current.handleAgentClick> = null;
      act(() => {
        created = result.current.handleAgentClick(PROJECT_ID, agent);
      });

      // 第 11 次应返回 null（上限），不再创建新 tab
      expect(created).toBeNull();
      expect(result.current.getTabs(SPACE)).toHaveLength(10);
    });
  });
});

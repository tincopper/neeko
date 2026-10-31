import { useCallback } from 'react';
import { useShallow } from 'zustand/shallow';

import { useEditorStore } from '@/shared/store/editorStore';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import type { TerminalTab, AgentConfig, Tab, TerminalTabData } from '@/shared/types';
import { requireTabWorkspaceSession } from '@/shared/utils/tabIdentity';
import { nextTerminalTitle } from '@/shared/utils/terminalTabTitle';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { MAX_TERMINAL_TABS, generateTerminalTabId } from '../api/taskTerminal';
import { closeAllEditorTabs, closeEditorTab } from '../components/terminalTabCleanup';

function generateTabId(): string {
  return generateTerminalTabId();
}

/** Type guard: narrow Tab to terminal kind */
function isTerminalTab(tab: Tab): tab is Tab & { data: TerminalTabData } {
  return tab.data.kind === 'terminal';
}

/** Convert a unified Tab (terminal kind) to legacy TerminalTab */
function tabToTerminalTab(tab: Tab & { data: TerminalTabData }): TerminalTab {
  return {
    id: tab.id,
    projectId: requireTabWorkspaceSession(tab).projectId,
    agentId: tab.data.agentId,
    title: tab.title,
  };
}

export function useTerminalTabs() {
  // Subscribe to the entire tabs record for reactivity
  const storeTabs = useEditorStore(useShallow((state) => state.tabs));

  const getTabs = useCallback(
    (projectId: string): TerminalTab[] => {
      const projectTabs = storeTabs[projectId];
      if (!projectTabs) return [];
      return projectTabs.tabs.filter(isTerminalTab).map(tabToTerminalTab);
    },
    [storeTabs],
  );

  const addTab = useCallback(
    // `agentName` 已不再参与标题：tab 的 agent 身份由前导图标表达，标题只说「第几个终端」
    // 或会话真实标题（注册表里的 prompt / OSC）。`pi` 这类 id 当标题对用户没有意义。
    (projectId: ProjectId, agentId?: string | null): TerminalTab | null => {
      const state = useEditorStore.getState();
      // 配额与既有 tab 检查按 store 键（= tab.scope 推导键）寻址，与 addTab 落键同形
      const existing = state.tabs[activeWorkspaceSession(projectId).key];
      const terminalCount = (existing?.tabs ?? []).filter(isTerminalTab).length;
      if (terminalCount >= MAX_TERMINAL_TABS) return null;

      const tabId = generateTabId();
      const title = nextTerminalTitle(existing);
      const newTab: Tab = {
        id: tabId,
        scope: { kind: 'workspace', session: activeWorkspaceSession(projectId) },
        title,
        data: {
          kind: 'terminal',
          agentId: agentId ?? null,
        },
      };

      state.addTab(newTab);
      state.activateTab(activeWorkspaceSession(projectId).key, tabId);

      return {
        id: tabId,
        projectId,
        agentId: agentId ?? null,
        title,
      };
    },
    [],
  );

  const closeTab = useCallback((projectId: string, tabId: string): void => {
    // Recycle terminal PTY caches then remove the editor tab.
    closeEditorTab(projectId, tabId);
  }, []);

  const activateTab = useCallback((projectId: string, tabId: string): void => {
    useEditorStore.getState().activateTab(projectId, tabId);
  }, []);

  // 换 agent 只改身份，**不改标题**：标题属于会话（注册表），不是 agent 的副本。
  const setTabAgent = useCallback(
    (projectId: string, tabId: string, agentId: string | null): void => {
      useEditorStore.getState().updateTab(projectId, tabId, { agentId });
    },
    [],
  );

  const updateTabTitle = useCallback((projectId: string, tabId: string, title: string): void => {
    useEditorStore.getState().updateTab(projectId, tabId, { title });
  }, []);

  const handleAgentClick = useCallback(
    (projectId: ProjectId, agent: AgentConfig): TerminalTab | null => {
      // Always create a new tab when clicking an agent
      return addTab(projectId, agent.id);
    },
    [addTab],
  );

  const clearProjectTabs = useCallback((projectId: string): void => {
    // Recycle all terminal PTY caches for this tab space then clear tabs.
    closeAllEditorTabs(projectId);
  }, []);

  return {
    getTabs,
    addTab,
    closeTab,
    activateTab,
    setTabAgent,
    updateTabTitle,
    handleAgentClick,
    clearProjectTabs,
  };
}

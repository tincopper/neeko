import { useCallback } from "react";
import { useShallow } from "zustand/shallow";
import type { TerminalTab, AgentConfig, Tab, TerminalTabData } from '@/shared/types';
import { destroyTerminalCachesByPrefix } from "../components/terminalCache";
import { useEditorStore } from '@/shared/store';

function generateTabId(): string {
  return `tab_${crypto.randomUUID()}`;
}

/** Type guard: narrow Tab to terminal kind */
function isTerminalTab(tab: Tab): tab is Tab & { data: TerminalTabData } {
  return tab.data.kind === "terminal";
}

/** Convert a unified Tab (terminal kind) to legacy TerminalTab */
function tabToTerminalTab(tab: Tab & { data: TerminalTabData }): TerminalTab {
  return {
    id: tab.id,
    projectId: tab.projectId,
    agentId: tab.data.agentId,
    title: tab.title,
    status: tab.data.status,
    order: tab.order,
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
    [storeTabs]
  );

  const getActiveTab = useCallback(
    (projectId: string): TerminalTab | null => {
      const projectTabs = storeTabs[projectId];
      if (!projectTabs) return null;

      const terminalTabs = projectTabs.tabs.filter(isTerminalTab);
      if (terminalTabs.length === 0) return null;

      // If activeTabId points to a terminal tab, use it
      const active = terminalTabs.find((t) => t.id === projectTabs.activeTabId);
      if (active) return tabToTerminalTab(active);

      // Otherwise, return the first terminal tab
      return tabToTerminalTab(terminalTabs[0]);
    },
    [storeTabs]
  );

  const getActiveTabId = useCallback(
    (projectId: string): string | null => {
      const projectTabs = storeTabs[projectId];
      if (!projectTabs) return null;

      const terminalTabs = projectTabs.tabs.filter(isTerminalTab);
      if (terminalTabs.length === 0) return null;

      // If activeTabId points to a terminal tab, use it
      if (terminalTabs.some((t) => t.id === projectTabs.activeTabId)) {
        return projectTabs.activeTabId;
      }

      // Otherwise, return the first terminal tab's ID
      return terminalTabs[0].id;
    },
    [storeTabs]
  );

  const ensureDefaultTab = useCallback(
    (projectId: string, agentId?: string | null, agentName?: string): string => {
      const state = useEditorStore.getState();
      const existing = state.tabs[projectId];
      const terminalTabs = existing?.tabs.filter(isTerminalTab) ?? [];

      if (terminalTabs.length > 0) {
        // Backfill agentId only on the sole auto-created terminal tab
        if (agentId && terminalTabs.length === 1 && terminalTabs[0].data.agentId === null) {
          state.updateTab(projectId, terminalTabs[0].id, {
            agentId,
            title: agentName ?? agentId,
          });
        }

        // 如果当前 active tab �?terminal tab，返回它
        const activeTerminal = terminalTabs.find((t) => t.id === existing?.activeTabId);
        if (activeTerminal) return activeTerminal.id;

        // 如果 active tab 不是 terminal tab，不要强制激�?terminal tab
        // 保留用户当前�?tab 选择（例�?file/diff tab�?
        return terminalTabs[0].id;
      }

      // Create a default terminal tab
      const tabId = generateTabId();
      const defaultTab: Tab = {
        id: tabId,
        projectId,
        title: agentName ?? (agentId ?? "Terminal"),
        order: existing?.tabs.length ?? 0,
        data: {
          kind: "terminal",
          agentId: agentId ?? null,
          status: "Idle",
        },
      };

      state.addTab(projectId, defaultTab);
      state.activateTab(projectId, tabId);
      return tabId;
    },
    []
  );

  const addTab = useCallback(
    (projectId: string, agentId?: string | null, agentName?: string): TerminalTab | null => {
      const state = useEditorStore.getState();
      const existing = state.tabs[projectId];
      const terminalCount = (existing?.tabs ?? []).filter(isTerminalTab).length;
      if (terminalCount >= 10) return null;

      const tabId = generateTabId();
      const newTab: Tab = {
        id: tabId,
        projectId,
        title: agentName ?? agentId ?? `Terminal ${terminalCount + 1}`,
        order: existing?.tabs.length ?? 0,
        data: {
          kind: "terminal",
          agentId: agentId ?? null,
          status: "Idle",
        },
      };

      state.addTab(projectId, newTab);
      state.activateTab(projectId, tabId);

      return {
        id: tabId,
        projectId,
        agentId: agentId ?? null,
        title: agentName ?? agentId ?? `Terminal ${terminalCount + 1}`,
        status: "Idle",
        order: newTab.order,
      };
    },
    []
  );

  const closeTab = useCallback(
    (projectId: string, tabId: string): void => {
      // Clean up terminal cache before closing
      destroyTerminalCachesByPrefix(`${projectId}:${tabId}`);
      useEditorStore.getState().closeTab(projectId, tabId);
    },
    []
  );

  const activateTab = useCallback(
    (projectId: string, tabId: string): void => {
      useEditorStore.getState().activateTab(projectId, tabId);
    },
    []
  );

  const setTabAgent = useCallback(
    (projectId: string, tabId: string, agentId: string | null, agentName?: string): void => {
      useEditorStore.getState().updateTab(projectId, tabId, {
        agentId,
        title: agentName ?? (agentId ? agentId : "Terminal"),
      });
    },
    []
  );

  const updateTabTitle = useCallback(
    (projectId: string, tabId: string, title: string): void => {
      useEditorStore.getState().updateTab(projectId, tabId, { title });
    },
    []
  );

  const updateTabStatus = useCallback(
    (projectId: string, tabId: string, status: TerminalTab["status"]): void => {
      useEditorStore.getState().updateTab(projectId, tabId, { status });
    },
    []
  );

  const handleAgentClick = useCallback(
    (projectId: string, agent: AgentConfig): TerminalTab | null => {
      // Always create a new tab when clicking an agent
      return addTab(projectId, agent.id, agent.name);
    },
    [addTab]
  );

  const clearProjectTabs = useCallback(
    (projectId: string): void => {
      // Clean up all terminal caches for this project
      const state = useEditorStore.getState();
      const existing = state.tabs[projectId];
      if (existing) {
        for (const tab of existing.tabs) {
          if (isTerminalTab(tab)) {
            destroyTerminalCachesByPrefix(`${projectId}:${tab.id}`);
          }
        }
      }
      state.clearProjectTabs(projectId);
    },
    []
  );

  return {
    getTabs,
    getActiveTab,
    getActiveTabId,
    ensureDefaultTab,
    addTab,
    closeTab,
    activateTab,
    setTabAgent,
    updateTabTitle,
    updateTabStatus,
    handleAgentClick,
    clearProjectTabs,
  };
}

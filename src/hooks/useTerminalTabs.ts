import { useState, useCallback, useRef, useEffect } from "react";
import type { TerminalTab, AgentConfig } from "../types";
import { destroyTerminalCachesByPrefix } from "../components/terminal";

function generateTabId(): string {
  return `tab_${crypto.randomUUID()}`;
}

const MAX_TABS = 10;

interface TabState {
  [projectId: string]: {
    tabs: TerminalTab[];
    activeTabId: string | null;
  };
}

export function useTerminalTabs() {
  const [tabState, setTabState] = useState<TabState>({});
  const tabStateRef = useRef<TabState>({});

  useEffect(() => {
    tabStateRef.current = tabState;
  }, [tabState]);

  const getTabs = useCallback(
    (projectId: string): TerminalTab[] => {
      return tabState[projectId]?.tabs ?? [];
    },
    [tabState]
  );

  const getActiveTab = useCallback(
    (projectId: string): TerminalTab | null => {
      const state = tabState[projectId];
      if (!state) return null;
      return state.tabs.find((t) => t.id === state.activeTabId) ?? null;
    },
    [tabState]
  );

  const getActiveTabId = useCallback(
    (projectId: string): string | null => {
      return tabState[projectId]?.activeTabId ?? null;
    },
    [tabState]
  );

  const ensureDefaultTab = useCallback(
    (projectId: string, agentId?: string | null, agentName?: string): string => {
      const existing = tabState[projectId];
      if (existing && existing.tabs.length > 0) {
        // Backfill agentId only on the sole auto-created tab (not user-added blank tabs)
        if (agentId && existing.tabs.length === 1 && existing.tabs[0].agentId === null) {
          setTabState(prev => {
            const s = prev[projectId];
            if (!s || s.tabs.length !== 1 || s.tabs[0].agentId !== null) return prev;
            const tab = s.tabs[0];
            return {
              ...prev,
              [projectId]: {
                ...s,
                tabs: [{ ...tab, agentId, title: agentName ?? agentId }],
              },
            };
          });
        }
        if (!existing.activeTabId) {
          const firstTabId = existing.tabs[0].id;
          setTabState((prev) => ({
            ...prev,
            [projectId]: { ...prev[projectId], activeTabId: firstTabId },
          }));
          return firstTabId;
        }
        return existing.activeTabId;
      }

      const defaultTab: TerminalTab = {
        id: generateTabId(),
        projectId,
        agentId: agentId ?? null,
        title: agentName ?? (agentId ?? "Terminal"),
        status: "Idle",
        order: 0,
      };

      setTabState((prev) => ({
        ...prev,
        [projectId]: { tabs: [defaultTab], activeTabId: defaultTab.id },
      }));

      return defaultTab.id;
    },
    [tabState]
  );

  const addTab = useCallback(
    (projectId: string, agentId?: string | null): TerminalTab | null => {
      const existing = tabState[projectId];
      const tabs = existing?.tabs ?? [];
      if (tabs.length >= MAX_TABS) return null;

      const agentName = agentId ? agentId : null;
      const newTab: TerminalTab = {
        id: generateTabId(),
        projectId,
        agentId: agentId ?? null,
        title: agentName ?? `Terminal ${tabs.length + 1}`,
        status: "Idle",
        order: tabs.length,
      };

      setTabState((prev) => {
        const currentTabs = prev[projectId]?.tabs ?? [];
        return {
          ...prev,
          [projectId]: {
            tabs: [...currentTabs, newTab],
            activeTabId: newTab.id,
          },
        };
      });

      return newTab;
    },
    [tabState]
  );

  const closeTab = useCallback(
    (projectId: string, tabId: string): void => {
      destroyTerminalCachesByPrefix(`${projectId}:${tabId}`);
      setTabState((prev) => {
        const state = prev[projectId];
        if (!state) return prev;

        const tabs = state.tabs.filter((t) => t.id !== tabId);

        let activeTabId = state.activeTabId;
        if (activeTabId === tabId) {
          const closedIndex = state.tabs.findIndex((t) => t.id === tabId);
          activeTabId =
            tabs[Math.min(closedIndex, tabs.length - 1)]?.id ?? null;
        }

        return {
          ...prev,
          [projectId]: { tabs, activeTabId },
        };
      });
    },
    []
  );

  const activateTab = useCallback(
    (projectId: string, tabId: string): void => {
      setTabState((prev) => {
        const state = prev[projectId];
        if (!state) return prev;
        if (!state.tabs.find((t) => t.id === tabId)) return prev;
        return {
          ...prev,
          [projectId]: { ...state, activeTabId: tabId },
        };
      });
    },
    []
  );

  const setTabAgent = useCallback(
    (projectId: string, tabId: string, agentId: string | null, agentName?: string): void => {
      setTabState((prev) => {
        const state = prev[projectId];
        if (!state) return prev;

        const tabs = state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                agentId,
                title: agentName ?? (agentId ? agentId : "Terminal"),
              }
            : t
        );

        return { ...prev, [projectId]: { ...state, tabs } };
      });
    },
    []
  );

  const updateTabTitle = useCallback(
    (projectId: string, tabId: string, title: string): void => {
      setTabState((prev) => {
        const state = prev[projectId];
        if (!state) return prev;

        const tabs = state.tabs.map((t) =>
          t.id === tabId ? { ...t, title } : t
        );

        return { ...prev, [projectId]: { ...state, tabs } };
      });
    },
    []
  );

  const updateTabStatus = useCallback(
    (projectId: string, tabId: string, status: TerminalTab["status"]): void => {
      setTabState((prev) => {
        const state = prev[projectId];
        if (!state) return prev;

        const tabs = state.tabs.map((t) =>
          t.id === tabId ? { ...t, status } : t
        );

        return { ...prev, [projectId]: { ...state, tabs } };
      });
    },
    []
  );

  const handleAgentClick = useCallback(
    (
      projectId: string,
      agent: AgentConfig,
    ): TerminalTab | null => {
      // 点击 Agent 时始终新建 tab
      return addTab(projectId, agent.id);
    },
    [addTab]
  );

  const clearProjectTabs = useCallback(
    (projectId: string): void => {
      setTabState((prev) => {
        const { [projectId]: _, ...rest } = prev;
        return rest;
      });
    },
    []
  );

  return {
    tabState,
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

import { useCallback, useEffect } from "react";
import { useEditorStore } from '@/shared/store';
import { useTerminalTabs } from '@/features/terminal/hooks/useTerminalTabs';
import { buildWorktreeTabKey } from '@/shared/utils/tabKey';

const APP_SETTINGS_PROJECT_ID = "__app__";

interface UseTabManagementOptions {
  activeProject: { id: string; selected_agent?: string | null } | null;
  activeWorktreePath: string | null;
  agents: { id: string; name?: string }[] | null;
}

export function useTabManagement(options: UseTabManagementOptions) {
  const { activeProject, activeWorktreePath, agents } = options;

  const {
    getTabs,
    ensureDefaultTab,
    addTab,
    activateTab,
    updateTabStatus,
    handleAgentClick: handleTabAgentClick,
  } = useTerminalTabs();

  const currentProjectId = activeProject?.id ?? null;

  const tabKey = activeWorktreePath && currentProjectId
    ? buildWorktreeTabKey(currentProjectId, activeWorktreePath)
    : (currentProjectId ?? APP_SETTINGS_PROJECT_ID);

  useEffect(() => {
    if (!tabKey) return;
    if (tabKey === APP_SETTINGS_PROJECT_ID) return;
    if (activeProject && !activeWorktreePath) return;

    const projectTabs = useEditorStore.getState().tabs[tabKey];
    const hasAnyTabs = projectTabs && projectTabs.tabs.length > 0;

    if (!hasAnyTabs) {
      const agentId = activeProject?.selected_agent ?? null;
      const agentName = agentId ? (agents?.find((a) => a.id === agentId)?.name ?? undefined) : undefined;
      ensureDefaultTab(tabKey, agentId, agentName);
    }
  }, [tabKey, ensureDefaultTab, activeProject?.selected_agent, agents, activeProject, activeWorktreePath]);

  const tabs = tabKey ? getTabs(tabKey) : [];
  const activeTabId = useEditorStore((state) => state.activeTabId);

  const handleAddTab = useCallback(() => {
    if (!tabKey) return;
    addTab(tabKey);
  }, [tabKey, addTab]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const state = useEditorStore.getState();
      for (const [projectId, pt] of Object.entries(state.tabs)) {
        if (pt.tabs.some((t) => t.id === tabId)) {
          state.closeTab(projectId, tabId);
          return;
        }
      }
    },
    [],
  );

  const handleActivateTab = useCallback(
    (tabId: string) => {
      if (!tabKey) return;
      activateTab(tabKey, tabId);
    },
    [tabKey, activateTab],
  );

  const handleTabStatusChange = useCallback(
    (tabId: string, status: "Idle" | "Running" | "Failed") => {
      if (!tabKey) return;
      updateTabStatus(tabKey, tabId, status);
    },
    [tabKey, updateTabStatus],
  );

  return {
    tabKey,
    tabs,
    activeTabId,
    handleAddTab,
    handleCloseTab,
    handleActivateTab,
    handleTabStatusChange,
    handleTabAgentClick,
  };
}

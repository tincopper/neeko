import { useCallback } from 'react';

import { closeEditorTab, useTerminalTabs } from '@/features/terminal';
import { useEditorStore } from '@/shared/store';
import { resolveTabKey } from '@/shared/utils/tabKey';

const APP_SETTINGS_PROJECT_ID = '__app__';

interface UseTabManagementOptions {
  activeProject: { id: string; selected_agents?: string[] } | null;
  activeWorktreePath: string | null;
}

export function useTabManagement(options: UseTabManagementOptions) {
  const { activeProject, activeWorktreePath } = options;

  const {
    getTabs,
    addTab,
    activateTab,
    updateTabStatus,
    handleAgentClick: handleTabAgentClick,
  } = useTerminalTabs();

  const currentProjectId = activeProject?.id ?? null;

  const tabKey = currentProjectId
    ? resolveTabKey(currentProjectId, activeWorktreePath)
    : APP_SETTINGS_PROJECT_ID;

  const tabs = tabKey ? getTabs(tabKey) : [];
  const activeTabId = useEditorStore((state) => state.activeTabId);

  const handleAddTab = useCallback(() => {
    if (!tabKey) return;
    addTab(tabKey);
  }, [tabKey, addTab]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      if (!tabKey) return;
      // Recycle PTY before removing the editor tab (Cmd+W / shell close).
      closeEditorTab(tabKey, tabId);
    },
    [tabKey],
  );

  const handleActivateTab = useCallback(
    (tabId: string) => {
      if (!tabKey) return;
      activateTab(tabKey, tabId);
    },
    [tabKey, activateTab],
  );

  const handleTabStatusChange = useCallback(
    (tabId: string, status: 'Idle' | 'Running' | 'Failed') => {
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

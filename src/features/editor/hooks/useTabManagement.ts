import { useCallback } from 'react';

import {
  closeTabWithConfirmation,
  type SaveTabAction,
} from '@/features/editor/store/closeConfirmStore';
import { useTerminalTabs } from '@/features/terminal';
import { useEditorStore } from '@/shared/store/editorStore';
import { useActiveWorkspaceKey } from '@/shared/store/workspaceStore';

const APP_SETTINGS_PROJECT_ID = '__app__';

interface UseTabManagementOptions {
  activeProject: { id: string; selected_agents?: string[] } | null;
  /** 保存指定文件 tab（关闭确认「保存」分支），由 useAppShellData 注入 fileView.saveTabById。 */
  saveTabById?: SaveTabAction;
}

export function useTabManagement(options: UseTabManagementOptions) {
  const { activeProject, saveTabById } = options;

  const {
    getTabs,
    addTab,
    activateTab,
    updateTabStatus,
    handleAgentClick: handleTabAgentClick,
  } = useTerminalTabs();

  const currentProjectId = activeProject?.id ?? null;

  // 激活 key 走唯一派生点（激活态单源）；无激活项目 = 应用设置空间。
  const activeKey = useActiveWorkspaceKey(currentProjectId);
  const tabKey = currentProjectId ? activeKey : APP_SETTINGS_PROJECT_ID;

  const tabs = tabKey ? getTabs(tabKey) : [];
  const activeTabId = useEditorStore((state) => state.activeTabId);

  const handleAddTab = useCallback(() => {
    if (!tabKey) return;
    addTab(tabKey);
  }, [tabKey, addTab]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      if (!tabKey) return;
      // Cmd+W / shell close：与 X 按钮同一确认编排（dirty → 三选 → save/discard/cancel），
      // 关闭统一经 closeTabWithConfirmation（PTY 回收在 closeEditorTab 内完成）。
      return closeTabWithConfirmation(tabKey, tabId, saveTabById);
    },
    [tabKey, saveTabById],
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

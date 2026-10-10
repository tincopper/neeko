import { useCallback } from 'react';

import {
  closeTabWithConfirmation,
  type SaveTabAction,
} from '@/features/editor/store/closeConfirmStore';
import { useTerminalTabs } from '@/features/terminal';
import { useEditorStore } from '@/shared/store/editorStore';
import { useActiveWorkspaceKey } from '@/shared/store/workspaceStore';
import type { AgentConfig, TerminalTab } from '@/shared/types';
import { tabSpaceKeyOf } from '@/shared/utils/tabIdentity';
import type { ProjectId } from '@/shared/utils/workspaceRef';

interface UseTabManagementOptions {
  activeProject: { id: ProjectId; selected_agents?: string[] } | null;
  /** 保存指定文件 tab（关闭确认「保存」分支），由 useAppShellData 注入 fileView.saveTabById。 */
  saveTabById?: SaveTabAction;
}

export function useTabManagement(options: UseTabManagementOptions) {
  const { activeProject, saveTabById } = options;

  const { getTabs, addTab, activateTab, updateTabStatus, handleAgentClick } = useTerminalTabs();

  const currentProjectId = activeProject?.id ?? null;

  // 激活 key 走唯一派生点（激活态单源）；无激活项目 = 应用设置空间。
  const activeKey = useActiveWorkspaceKey(currentProjectId);
  const tabKey = currentProjectId ? activeKey : tabSpaceKeyOf({ kind: 'app' });

  const tabs = tabKey ? getTabs(tabKey) : [];
  const activeTabId = useEditorStore((state) => state.activeTabId);

  const handleAddTab = useCallback(() => {
    if (!currentProjectId) return;
    addTab(currentProjectId);
  }, [currentProjectId, addTab]);

  // agent 点击入口仍以 tab 键为形参（沿用既有调用签名），内部收敛为真实 project id ——
  // 避免把复合 tab 键当身份交给 addTab（原事故同型）。
  const handleTabAgentClick = useCallback(
    (_tabKey: string, agent: AgentConfig): TerminalTab | null =>
      currentProjectId ? handleAgentClick(currentProjectId, agent) : null,
    [currentProjectId, handleAgentClick],
  );

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

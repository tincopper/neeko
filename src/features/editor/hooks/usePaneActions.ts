import { useCallback, useMemo } from 'react';

import type { ActionRegistryItem, ActionContext } from '@/features/action-menu/types/actionMenu';
import { openAgentChatTab } from '@/features/agent-chat/api/openChatTab';
import { useQuickOpenStore } from '@/features/quick-open/store/quickOpenStore';
import { useRecentFilesStore } from '@/features/quick-open/store/recentFilesStore';
import { panelView } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import type { AgentConfig, EditorGroupId, EditorPaneId } from '@/shared/types';
import { centerDropTargetOf } from '@/shared/types/editorGroup';
import { createUntitledFileTab } from '@/shared/utils/createUntitledFileTab';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { closeTabWithConfirmation } from '../store/closeTab';

interface UsePaneActionsParams {
  tabKey: string;
  paneId: EditorPaneId;
  projectIdForCheck: ProjectId | null;
  /** Action Menu 的 agent 数据源：由调用方传入已过滤列表（installedEnabledAgents）。 */
  agents: AgentConfig[];
  /** 新建终端 tab；targetGroup 由发起 pane 决定（pinned pane 内创建落 pinned）。 */
  onAddTerminalTab?: (targetGroup?: EditorGroupId | 'pinned') => void;
  onActionMenuClose: () => void;
  /** 保存指定 tab（关闭确认中用户选择「保存」时调用）。返回 true 表示保存成功。 */
  onSaveTab?: (tabId: string) => Promise<boolean>;
}

/**
 * EditorGroupPane 的 tab 操作 + Action Menu 触发与执行逻辑。
 */
export function usePaneActions({
  tabKey,
  paneId,
  projectIdForCheck,
  agents,
  onAddTerminalTab,
  onActionMenuClose,
  onSaveTab,
}: UsePaneActionsParams) {
  // 新建 tab 的落组：dock 宿主不是落组（`chrome: 'dock'` 下这些入口不渲染），
  // 返回 null 时退回 addTab 的缺省落组（当前中心组）。
  const dropTarget = centerDropTargetOf(paneId);

  const handleActivateTab = useCallback(
    (tabId: string) => {
      useEditorStore.getState().activateTab(tabKey, tabId);
    },
    [tabKey],
  );

  const handleCloseTab = useCallback(
    async (tabId: string) => {
      if (paneId === 'pinned') return;
      // dirty → 三选确认编排统一走全局 closeConfirmStore（与菜单/Cmd+W 路径同源）
      await closeTabWithConfirmation(tabKey, tabId, onSaveTab);
    },
    [tabKey, paneId, onSaveTab],
  );

  const handleActionMenuExecute = useCallback(
    (item: ActionRegistryItem) => {
      switch (item.id) {
        case 'new-terminal':
          // 新建 tab 落组跟随发起 pane（pinned pane 内创建落 pinned）
          onAddTerminalTab?.(dropTarget ?? undefined);
          break;
        case 'open-file':
          useQuickOpenStore.getState().openPalette('gotoFile');
          break;
        case 'recent-files':
          useQuickOpenStore.getState().openPalette('recentFiles');
          break;
        case 'new-agent-chat': {
          if (projectIdForCheck) {
            // 落组跟随发起 pane（pinned pane 内创建落 pinned）；id / 激活在端口内。
            openAgentChatTab(activeWorkspaceSession(projectIdForCheck), {
              targetGroup: dropTarget ?? undefined,
            });
          }
          break;
        }
        case 'new-browser': {
          if (projectIdForCheck) {
            const tabId = `tab_${crypto.randomUUID()}`;
            useEditorStore.getState().addTab(
              {
                id: tabId,
                scope: { kind: 'workspace', session: activeWorkspaceSession(projectIdForCheck) },
                title: 'Browser',
                data: {
                  kind: 'browser' as const,
                  url: '',
                },
              },
              dropTarget ?? undefined,
            );
            useEditorStore.getState().activateTab(tabKey, tabId);
          }
          break;
        }
        case 'new-file': {
          if (projectIdForCheck) {
            createUntitledFileTab(projectIdForCheck, dropTarget ?? undefined);
          }
          break;
        }
        case 'open-side-terminal': {
          useDockStore.getState().toggleView(panelView('projects'));
          break;
        }
        case 'open-in-ide': {
          const store = useProjectStore.getState();
          const p = store.activeProject;
          if (p) {
            store.openIde({ id: p.id, selected_ide: p.selected_ide });
          }
          break;
        }
      }
    },
    [dropTarget, onAddTerminalTab, projectIdForCheck, tabKey],
  );

  const handleActionMenuAgentTerminal = useCallback(
    // 占位标题 = agent 名（初版行为）；会话真标题到手后由 `resolveTabTitle` 覆盖。
    (agentId: string, agentName: string) => {
      if (!projectIdForCheck) return;
      const tabId = `tab_${crypto.randomUUID()}`;
      useEditorStore.getState().addTab(
        {
          id: tabId,
          scope: { kind: 'workspace', session: activeWorkspaceSession(projectIdForCheck) },
          title: agentName,
          data: {
            kind: 'terminal' as const,
            agentId,
          },
        },
        dropTarget ?? undefined,
      );
      useEditorStore.getState().activateTab(tabKey, tabId);
    },
    [dropTarget, tabKey, projectIdForCheck],
  );

  // 双击 tab 栏空白区域快速新建文件
  const handleNewFileTab = useCallback(() => {
    if (projectIdForCheck) {
      createUntitledFileTab(projectIdForCheck, dropTarget ?? undefined);
    }
  }, [dropTarget, projectIdForCheck]);

  const actionMenuCtx: ActionContext = useMemo(
    () => ({
      projectId: projectIdForCheck,
      tabKey,
      agents,
      recentFiles: projectIdForCheck
        ? useRecentFilesStore
            .getState()
            .list(projectIdForCheck)
            .map((r) => r.filePath)
        : [],
      closeMenu: onActionMenuClose,
    }),
    [projectIdForCheck, tabKey, agents, onActionMenuClose],
  );

  return {
    handleActivateTab,
    handleCloseTab,
    handleActionMenuExecute,
    handleActionMenuAgentTerminal,
    handleNewFileTab,
    actionMenuCtx,
  };
}

import { useCallback, useMemo } from 'react';

import type { ActionRegistryItem, ActionContext } from '@/features/action-menu/types/actionMenu';
import { useQuickOpenStore } from '@/features/quick-open/store/quickOpenStore';
import { useRecentFilesStore } from '@/features/quick-open/store/recentFilesStore';
import { closeEditorTab } from '@/features/terminal';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { AgentConfig, EditorGroupId } from '@/shared/types';
import { createUntitledFileTab } from '@/shared/utils/createUntitledFileTab';

interface UsePaneActionsParams {
  tabKey: string;
  groupId: EditorGroupId | 'pinned';
  tabs: {
    id: string;
    data: {
      kind: string;
      isUntitled?: boolean;
      isDirty?: boolean;
      untitledName?: string;
      fileName?: string;
    };
  }[];
  projectIdForCheck: string | null;
  agents: AgentConfig[];
  onAddTerminalTab?: () => void;
  onActionMenuClose: () => void;
  /** 未保存关闭确认回调：返回 true 表示用户确认关闭 */
  onRequestCloseTab?: (fileName: string) => Promise<boolean>;
}

/**
 * EditorGroupPane 的 tab 操作 + Action Menu 触发与执行逻辑。
 */
export function usePaneActions({
  tabKey,
  groupId,
  tabs,
  projectIdForCheck,
  agents,
  onAddTerminalTab,
  onActionMenuClose,
  onRequestCloseTab,
}: UsePaneActionsParams) {
  const handleActivateTab = useCallback(
    (tabId: string) => {
      useEditorStore.getState().activateTab(tabKey, tabId);
    },
    [tabKey],
  );

  const handleCloseTab = useCallback(
    async (tabId: string) => {
      if (groupId === 'pinned') return;
      const tab = tabs.find((t) => t.id === tabId);
      if (tab?.data.kind === 'file' && tab.data.isUntitled && tab.data.isDirty) {
        const fileName = tab.data.untitledName ?? tab.data.fileName ?? 'Untitled';
        if (onRequestCloseTab) {
          const confirmed = await onRequestCloseTab(fileName);
          if (!confirmed) return;
        }
      }
      closeEditorTab(tabKey, tabId);
    },
    [tabKey, groupId, tabs, onRequestCloseTab],
  );

  const handleReorderTab = useCallback(
    (tabId: string, overId: string) => {
      if (groupId === 'pinned') return;
      useEditorStore.getState().reorderTab(tabKey, groupId, tabId, overId);
    },
    [tabKey, groupId],
  );

  const handleActionMenuExecute = useCallback(
    (item: ActionRegistryItem) => {
      switch (item.id) {
        case 'new-terminal':
          onAddTerminalTab?.();
          break;
        case 'open-file':
          useQuickOpenStore.getState().openPalette('gotoFile');
          break;
        case 'recent-files':
          useQuickOpenStore.getState().openPalette('recentFiles');
          break;
        case 'new-terminal-with-agent': {
          if (projectIdForCheck) {
            const enabled = agents.filter((a) => a.enabled);
            const first = enabled[0];
            if (first) {
              const tabId = `tab_${crypto.randomUUID()}`;
              useEditorStore.getState().addTab(tabKey, {
                id: tabId,
                projectId: projectIdForCheck,
                title: first.name,
                order: tabs.length,
                data: {
                  kind: 'terminal' as const,
                  agentId: first.id,
                  status: 'Idle' as const,
                },
              });
              useEditorStore.getState().activateTab(tabKey, tabId);
            }
          }
          break;
        }
        case 'new-file': {
          if (projectIdForCheck) {
            createUntitledFileTab(tabKey, projectIdForCheck);
          }
          break;
        }
        case 'open-side-terminal': {
          useDockStore.getState().togglePanel('projects');
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
    [onAddTerminalTab, agents, projectIdForCheck, tabKey, tabs.length],
  );

  const handleActionMenuAgentTerminal = useCallback(
    (agentId: string, agentName: string) => {
      if (!projectIdForCheck) return;
      const tabId = `tab_${crypto.randomUUID()}`;
      useEditorStore.getState().addTab(tabKey, {
        id: tabId,
        projectId: projectIdForCheck,
        title: agentName,
        order: tabs.length,
        data: {
          kind: 'terminal' as const,
          agentId,
          status: 'Idle' as const,
        },
      });
      useEditorStore.getState().activateTab(tabKey, tabId);
    },
    [tabKey, projectIdForCheck, tabs.length],
  );

  // 双击 tab 栏空白区域快速新建文件
  const handleNewFileTab = useCallback(() => {
    if (projectIdForCheck) {
      createUntitledFileTab(tabKey, projectIdForCheck);
    }
  }, [tabKey, projectIdForCheck]);

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
    handleReorderTab,
    handleActionMenuExecute,
    handleActionMenuAgentTerminal,
    handleNewFileTab,
    actionMenuCtx,
  };
}

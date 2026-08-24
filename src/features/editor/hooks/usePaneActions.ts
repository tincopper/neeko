import { useCallback, useMemo } from 'react';

import type { ActionRegistryItem, ActionContext } from '@/features/action-menu/types/actionMenu';
import { useQuickOpenStore } from '@/features/quick-open/store/quickOpenStore';
import { useRecentFilesStore } from '@/features/quick-open/store/recentFilesStore';
import { closeEditorTab } from '@/features/terminal';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { AgentConfig, EditorGroupId, Tab } from '@/shared/types';
import { createUntitledFileTab } from '@/shared/utils/createUntitledFileTab';
import { getTabDisplayName, isDirtyFileTab } from '@/shared/utils/fileTree';

interface UsePaneActionsParams {
  tabKey: string;
  groupId: EditorGroupId | 'pinned';
  tabs: Tab[];
  projectIdForCheck: string | null;
  agents: AgentConfig[];
  onAddTerminalTab?: () => void;
  onActionMenuClose: () => void;
  /**
   * 未保存关闭确认回调：返回用户的选择。
   * - 'save'    → 先保存再关闭
   * - 'discard' → 不保存直接关闭
   * - 'cancel'  → 取消关闭
   */
  onRequestCloseTab?: (tabId: string, fileName: string) => Promise<'save' | 'discard' | 'cancel'>;
  /** 保存指定 tab（关闭确认中用户选择「保存」时调用）。返回 true 表示保存成功。 */
  onSaveTab?: (tabId: string) => Promise<boolean>;
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
  onSaveTab,
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
      if (tab && isDirtyFileTab(tab)) {
        const fileName = getTabDisplayName(tab);
        if (onRequestCloseTab) {
          const action = await onRequestCloseTab(tabId, fileName);
          if (action === 'cancel') return;
          if (action === 'save') {
            const saved = onSaveTab ? await onSaveTab(tabId) : false;
            // 保存失败（含 untitled 的 Save As 取消/失败）→ 不关闭
            if (!saved) return;
          }
          // 'discard' → 直接关闭
        }
      }
      closeEditorTab(tabKey, tabId);
    },
    [tabKey, groupId, tabs, onRequestCloseTab, onSaveTab],
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
        case 'new-agent-chat': {
          if (projectIdForCheck) {
            const tabId = `tab_${crypto.randomUUID()}`;
            useEditorStore.getState().addTab(tabKey, {
              id: tabId,
              projectId: projectIdForCheck,
              title: 'Agent Chat',
              order: tabs.length,
              data: {
                kind: 'agent-chat' as const,
                agentId: undefined,
                sessionId: undefined,
              },
            });
            useEditorStore.getState().activateTab(tabKey, tabId);
          }
          break;
        }
        case 'new-browser': {
          if (projectIdForCheck) {
            const tabId = `tab_${crypto.randomUUID()}`;
            useEditorStore.getState().addTab(tabKey, {
              id: tabId,
              projectId: projectIdForCheck,
              title: 'Browser',
              order: tabs.length,
              data: {
                kind: 'browser' as const,
                url: '',
              },
            });
            useEditorStore.getState().activateTab(tabKey, tabId);
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

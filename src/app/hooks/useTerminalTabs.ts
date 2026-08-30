import { useCallback } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import type { AgentConfig, EditorGroupId, Tab } from '@/shared/types';

const MAX_TERMINAL_TABS = 10;

/**
 * 工作区终端 Tab 创建：普通终端 + 指定 agent 的终端。
 * 从 ProjectWorkspace 抽出，集中终端 Tab 的构造与激活。
 */
export function useTerminalTabs(
  tabKey: string | null,
  projectId: string | null,
): {
  handleAddTerminalTab: (targetGroup?: EditorGroupId | 'pinned') => void;
  handleAddAgentTab: (agent: AgentConfig, targetGroup?: EditorGroupId | 'pinned') => void;
} {
  const handleAddTerminalTab = useCallback(
    (targetGroup?: EditorGroupId | 'pinned') => {
      if (!tabKey || !projectId) return;
      const existingTabs = useEditorStore.getState().tabs[tabKey];
      const terminalCount = (existingTabs?.tabs ?? []).filter(
        (t) => t.data.kind === 'terminal',
      ).length;
      if (terminalCount >= MAX_TERMINAL_TABS) return;

      const tabId = `tab_${crypto.randomUUID()}`;
      const tab: Tab = {
        id: tabId,
        projectId,
        title: `Terminal ${terminalCount + 1}`,
        order: existingTabs?.tabs.length ?? 0,
        data: {
          kind: 'terminal',
          agentId: null,
          status: 'Idle',
        },
      };
      useEditorStore.getState().addTab(tabKey, tab, targetGroup);
      useEditorStore.getState().activateTab(tabKey, tabId);
    },
    [tabKey, projectId],
  );

  const handleAddAgentTab = useCallback(
    (agent: AgentConfig, targetGroup?: EditorGroupId | 'pinned') => {
      if (!tabKey || !projectId) return;
      const tabId = `tab_${crypto.randomUUID()}`;
      const tab: Tab = {
        id: tabId,
        projectId,
        title: agent.name,
        order: 0,
        data: {
          kind: 'terminal',
          agentId: agent.id,
          status: 'Idle',
        },
      };
      useEditorStore.getState().addTab(tabKey, tab, targetGroup);
      useEditorStore.getState().activateTab(tabKey, tabId);
    },
    [tabKey, projectId],
  );

  return { handleAddTerminalTab, handleAddAgentTab };
}

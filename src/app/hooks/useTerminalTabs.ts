import { useCallback } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import type { AgentConfig, EditorGroupId, Tab } from '@/shared/types';
import type { ProjectId } from '@/shared/utils/workspaceRef';

const MAX_TERMINAL_TABS = 10;

/**
 * 工作区终端 Tab 创建：普通终端 + 指定 agent 的终端。
 * 从 ProjectView 抽出，集中终端 Tab 的构造与激活。
 *
 * 身份来源 = `activeWorkspaceSession(projectId)`（身份源单点）：tab.scope 携带完整
 * WorkspaceSession，store 键由 addTab 内部从 scope 推导（构造律）—— 调用方传的
 * `tabKey` 只用于 activateTab 读取路径，不再流入 tab 身份字段。
 */
export function useTerminalTabs(
  tabKey: string | null,
  projectId: ProjectId | null,
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
        scope: { kind: 'workspace', session: activeWorkspaceSession(projectId) },
        title: `Terminal ${terminalCount + 1}`,
        order: existingTabs?.tabs.length ?? 0,
        data: {
          kind: 'terminal',
          agentId: null,
          status: 'Idle',
        },
      };
      useEditorStore.getState().addTab(tab, targetGroup);
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
        scope: { kind: 'workspace', session: activeWorkspaceSession(projectId) },
        title: agent.name,
        order: 0,
        data: {
          kind: 'terminal',
          agentId: agent.id,
          status: 'Idle',
        },
      };
      useEditorStore.getState().addTab(tab, targetGroup);
      useEditorStore.getState().activateTab(tabKey, tabId);
    },
    [tabKey, projectId],
  );

  return { handleAddTerminalTab, handleAddAgentTab };
}

import { useCallback } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import type { AgentConfig, EditorGroupId, Tab } from '@/shared/types';
import { nextTerminalTitle } from '@/shared/utils/terminalTabTitle';
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
  /**
   * 两个入口只差 `agentId` / 占位标题（与是否受配额约束）：构造逻辑合并成一份。
   *
   * `title` 是**会话起名前的占位**：agent tab 用 agent 名，空白终端用 `Terminal N`。
   * 会话真标题到手后由 `resolveTabTitle` 在渲染期覆盖（不写回 store）。
   */
  const addTerminalTab = useCallback(
    (
      agentId: string | null,
      title: string,
      targetGroup: EditorGroupId | 'pinned' | undefined,
    ): void => {
      if (!tabKey || !projectId) return;
      const tabId = `tab_${crypto.randomUUID()}`;
      const tab: Tab = {
        id: tabId,
        scope: { kind: 'workspace', session: activeWorkspaceSession(projectId) },
        title,
        data: { kind: 'terminal', agentId },
      };
      useEditorStore.getState().addTab(tab, targetGroup);
      useEditorStore.getState().activateTab(tabKey, tabId);
    },
    [tabKey, projectId],
  );

  const handleAddTerminalTab = useCallback(
    (targetGroup?: EditorGroupId | 'pinned') => {
      if (!tabKey) return;
      const existing = useEditorStore.getState().tabs[tabKey];
      const terminalCount = (existing?.tabs ?? []).filter((t) => t.data.kind === 'terminal').length;
      // 配额只约束「空白终端」入口；点 agent 是显式意图，不静默拒绝（行为保持原样）。
      if (terminalCount >= MAX_TERMINAL_TABS) return;
      addTerminalTab(null, nextTerminalTitle(existing), targetGroup);
    },
    [tabKey, addTerminalTab],
  );

  const handleAddAgentTab = useCallback(
    (agent: AgentConfig, targetGroup?: EditorGroupId | 'pinned') => {
      addTerminalTab(agent.id, agent.name, targetGroup);
    },
    [addTerminalTab],
  );

  return { handleAddTerminalTab, handleAddAgentTab };
}

import { useCallback } from 'react';

import type { AgentConfig, EditorGroupId } from '@/shared/types';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { createPlainTerminalTab, createTerminalTab } from '../utils/terminalTab';

/**
 * 工作区终端 Tab 创建的 React 适配层（纯 shell + 指定 agent 两条入口）。
 *
 * 构造本身在 `app/utils/terminalTab`（无 React，工具栏的 Terminal 图标也复用它）：
 * 两个入口只差 `agentId` / 占位标题 / 是否受配额约束，构造逻辑只能有一份。
 *
 * `title` 是**会话起名前的占位**：agent tab 用 agent 名，空白终端用 `Terminal N`。
 * 会话真标题到手后由 `resolveTabTitle` 在渲染期覆盖（不写回 store）。
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
      createPlainTerminalTab(tabKey, projectId, targetGroup);
    },
    [tabKey, projectId],
  );

  const handleAddAgentTab = useCallback(
    (agent: AgentConfig, targetGroup?: EditorGroupId | 'pinned') => {
      if (!tabKey || !projectId) return;
      createTerminalTab({ tabKey, projectId, agentId: agent.id, title: agent.name, targetGroup });
    },
    [tabKey, projectId],
  );

  return { handleAddTerminalTab, handleAddAgentTab };
}

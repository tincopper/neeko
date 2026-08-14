import React, { useCallback } from 'react';

import {
  conversationTabTitle,
  ConversationPanel,
  type ConversationMeta,
} from '@/features/conversation';
import { useActiveProject } from '@/features/project';
import { useAppContext } from '@/shared/contexts';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { Tab } from '@/shared/types';
import { resolveTabKey } from '@/shared/utils/tabKey';

/**
 * Conversations dock 面板适配层：读取 project context + agent 列表透传
 * ConversationPanel；处理会话恢复（原生 resume 命令 → terminal tab）。
 */
const ConversationsPanelWrapper: React.FC = React.memo(() => {
  const { project, worktreePath } = useActiveProject();
  const { agents, showToast } = useAppContext();

  const projectPath = worktreePath ?? project?.path ?? null;
  const isActive = useDockStore((s) => {
    for (const zone of Object.values(s.zones)) {
      if (zone.activePanelId === 'conversations' && zone.expanded) return true;
    }
    return false;
  });

  // Determine project ID and tab key for opening conversation tabs
  const currentProjectId = useProjectStore((s) => s.activeProjectId);
  const activeWorktreePath = useWorktreeStore((s) => s.activeWorktreePath);
  const tabKey = currentProjectId
    ? resolveTabKey(currentProjectId, activeWorktreePath)
    : currentProjectId;

  const handleResumeConversation = useCallback(
    async (meta: ConversationMeta) => {
      if (!currentProjectId || !tabKey) {
        showToast('No project selected', 'error');
        return;
      }
      const { getAgent } = await import('@/features/agent/api/agentApi');
      const { getResumeCommand } = await import('@/features/conversation/api/conversationApi');
      // Get agent config
      let agentCommand: string;
      try {
        const agent = await getAgent(meta.agentId);
        agentCommand = agent.command;
      } catch {
        showToast(`Agent "${meta.agentId}" not found`, 'error');
        return;
      }

      // Native resume only (D4): no bare launch / context injection fallback.
      let resumeCmd: string[] | null = null;
      try {
        resumeCmd = await getResumeCommand(meta.id);
      } catch (err) {
        console.warn('[ConversationsPanel] Failed to get resume command:', err);
        showToast('Failed to resolve resume command', 'error');
        return;
      }

      if (!resumeCmd || resumeCmd.length === 0) {
        showToast('This conversation does not support native resume', 'error');
        return;
      }

      // Native resume: adapter returns e.g. ["--resume", "<id>"] or ["resume", "<id>"]
      const taskCommand = `${agentCommand} ${resumeCmd.join(' ')}`;

      // Create a new terminal tab — the PTY will execute taskCommand directly
      const tabId = `tab_${crypto.randomUUID()}`;
      const editorState = useEditorStore.getState();
      const existingTabs = editorState.tabs[tabKey];
      const terminalCount = (existingTabs?.tabs ?? []).filter(
        (t) => t.data.kind === 'terminal',
      ).length;
      if (terminalCount >= 10) {
        showToast('Maximum terminal tabs reached', 'error');
        return;
      }
      const tab: Tab = {
        id: tabId,
        projectId: currentProjectId,
        title: meta.agentId,
        order: existingTabs?.tabs.length ?? 0,
        data: {
          kind: 'terminal',
          agentId: meta.agentId,
          status: 'Idle',
          taskCommand,
        },
      };
      editorState.addTab(tabKey, tab);
      editorState.activateTab(tabKey, tabId);
    },
    [currentProjectId, tabKey, showToast],
  );

  const handleOpenConversationTab = useCallback(
    (meta: ConversationMeta) => {
      const editorState = useEditorStore.getState();
      const existingTabs = tabKey ? editorState.tabs[tabKey] : undefined;
      const tabId = `tab_${crypto.randomUUID()}`;
      const tab: Tab = {
        id: tabId,
        projectId: currentProjectId ?? tabKey ?? 'conversation',
        title: conversationTabTitle(meta),
        order: existingTabs?.tabs.length ?? 0,
        data: {
          kind: 'conversation',
          conversationId: meta.id,
          agentId: meta.agentId,
          conversationMeta: meta,
          onResume: handleResumeConversation,
        },
      };
      if (tabKey) {
        editorState.addTab(tabKey, tab);
        editorState.activateTab(tabKey, tabId);
      }
    },
    [currentProjectId, tabKey, handleResumeConversation],
  );

  return (
    <ConversationPanel
      projectPath={projectPath}
      projectId={currentProjectId}
      agents={agents}
      isActive={isActive}
      showToast={showToast}
      onOpenConversationTab={handleOpenConversationTab}
      onResumeConversation={handleResumeConversation}
    />
  );
});
ConversationsPanelWrapper.displayName = 'ConversationsPanelWrapper';

export default ConversationsPanelWrapper;
export { ConversationsPanelWrapper };

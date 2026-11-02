import React, { useCallback } from 'react';

import { useChatResumableAgents } from '@/features/agent-chat';
import { openAgentChatTab } from '@/features/agent-chat/api/openChatTab';
import {
  conversationLiveChatTabRefs,
  conversationTabTitle,
  conversationViewerTabRefs,
  ConversationPanel,
  flattenTabSpaces,
  runConversationDelete,
  type ConversationMeta,
} from '@/features/conversation';
import { deleteConversation } from '@/features/conversation/api/conversationApi';
import { useActiveProject } from '@/features/project';
import { createTaskTerminal } from '@/features/terminal';
import { useAppContext } from '@/shared/contexts';
import { confirmAction } from '@/shared/store/confirmStore';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { activeWorkspaceSession, useActiveWorkspaceKey } from '@/shared/store/workspaceStore';
import type { Tab } from '@/shared/types';
import { buildResumeTaskCommand } from '@/shared/utils/agentCommand';
import { logFrontendError } from '@/shared/utils/errorReporting';

/**
 * Conversations dock 面板适配层：读取 project context + agent 列表透传
 * ConversationPanel；处理会话恢复（原生 resume 命令 → terminal tab）。
 */
const ConversationsPanelWrapper: React.FC = React.memo(() => {
  const { project, worktreePath } = useActiveProject();
  const { agents, showToast } = useAppContext();

  /**
   * 「哪些 agent 能把原生会话恢复为 Agent Chat」的**唯一派生点**。
   *
   * 入口显隐必须与执行走同一个事实（后端 `agent_chat_supports_resume`），
   * 否则会出现「按钮在、点了报错」或「能用但没入口」。
   */
  const chatResumableAgents = useChatResumableAgents(agents);
  const canChatResume = useCallback(
    (agentId: string) => chatResumableAgents.has(agentId),
    [chatResumableAgents],
  );

  const projectPath = worktreePath ?? project?.path ?? null;
  const isActive = useDockStore((s) => {
    for (const zone of Object.values(s.zones)) {
      if (zone.activePanelId === 'conversations' && zone.expanded) return true;
    }
    return false;
  });

  // Determine project ID and tab key for opening conversation tabs
  const currentProjectId = useProjectStore((s) => s.activeProjectId);
  const activeWorkspaceKey = useActiveWorkspaceKey(currentProjectId);
  const tabKey = currentProjectId ? activeWorkspaceKey : currentProjectId;

  const handleResumeConversation = useCallback(
    async (meta: ConversationMeta) => {
      if (!currentProjectId || !tabKey) {
        showToast('No project selected', 'error');
        return;
      }
      const { getAgent } = await import('@/features/agent/api/agentApi');
      const { getResumeCommand } = await import('@/features/conversation/api/conversationApi');
      // Get agent config
      let agent: Awaited<ReturnType<typeof getAgent>>;
      try {
        agent = await getAgent(meta.agentId);
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

      // Native resume: adapter returns e.g. ["--resume", "<id>"] or ["resume", "<id>"].
      // 拼装与引号走 `agentCommand` 的唯一实现（侧栏「点回来」的恢复路径用同一个函数）。
      // PTY 直接执行 taskCommand，因此必须是完整命令行，而不是只给 resume 参数。
      const taskCommand = buildResumeTaskCommand(agent, resumeCmd);

      // 创建即激活、配额与占位标题都在 terminal 域的端口里（这里不手造 Tab）。
      if (!createTaskTerminal(currentProjectId, { agentId: meta.agentId, taskCommand })) {
        showToast('Maximum terminal tabs reached', 'error');
      }
    },
    [currentProjectId, tabKey, showToast],
  );

  const handleChatResumeConversation = useCallback(
    (meta: ConversationMeta) => {
      if (!currentProjectId || !tabKey || !meta.nativeSessionId) return;
      // id / 激活 / 落组在端口内；`resume*` 是 agent-chat 域的 data 语义。
      openAgentChatTab(activeWorkspaceSession(currentProjectId), {
        agentId: meta.agentId,
        title: `${meta.userTitle ?? meta.title ?? 'Agent Chat'}`,
        data: {
          sessionId: undefined,
          resumeConversationId: meta.id,
          resumeNativeSessionId: meta.nativeSessionId,
        },
      });
      showToast(`Restoring "${meta.userTitle ?? meta.title}" in Agent Chat…`, 'info');
    },
    [currentProjectId, tabKey, showToast],
  );

  /**
   * 删除编排的**容器层入口**。
   *
   * 三件事都在这里定：
   * 1. 「是否使用中」用**全量 tab**（跨 workspace 展平）——只看当前 tab 空间会漏；
   * 2. 确认文案拿 agent 显示名（用户认的是名字，不是 id）；
   * 3. 删除只传 id（路径由后端从自己的缓存解析，红线 8）。
   *
   * 返回 `true` 时面板才本地移除行（失败不乐观移除）。
   */
  const handleDeleteConversation = useCallback(
    async (meta: ConversationMeta): Promise<boolean> => {
      const tabsBySpace = useEditorStore.getState().tabs;
      const agentName = agents.find((a) => a.id === meta.agentId)?.name ?? null;
      const deleted = await runConversationDelete(meta, {
        tabs: flattenTabSpaces(tabsBySpace),
        showToast,
        confirm: confirmAction,
        deleteConversation,
        agentName,
        // 删除成功后关掉两类占用：活 Agent Chat tab（否则那条 chat 指向已删会话）与
        // 只读查看器 tab（文件没了，留着就是打不开的面板）。顺序在删除之后 —— 失败时
        // 用户还能继续看那份仍存在的会话。
        closeTabs: () => {
          const store = useEditorStore.getState();
          const refs = [
            ...conversationLiveChatTabRefs(store.tabs, meta),
            ...conversationViewerTabRefs(store.tabs, meta),
          ];
          for (const ref of refs) store.closeTab(ref.spaceKey, ref.tabId);
        },
        // 失败原因与阶段埋点落后端日志：toast 一闪而过、而「没反应」的三种成因
        // （没走到 / 确认框没弹 / 弹了没结算）在屏幕上完全一样（见 2026-10-30 排查）。
        reportError: (message) => {
          void logFrontendError({ source: `conversation.delete:${meta.id}`, message });
        },
        trace: (step) => {
          void logFrontendError({ source: `conversation.delete:${meta.id}`, message: step });
        },
      });
      return deleted;
    },
    [agents, showToast],
  );

  const handleOpenConversationTab = useCallback(
    (meta: ConversationMeta) => {
      if (!currentProjectId) return; // 无项目身份不开 tab（原 `?? tabKey ?? 'conversation'` 隐患已根除）
      const editorState = useEditorStore.getState();
      const tabId = `tab_${crypto.randomUUID()}`;
      const tab: Tab = {
        id: tabId,
        scope: { kind: 'workspace', session: activeWorkspaceSession(currentProjectId) },
        title: conversationTabTitle(meta),
        data: {
          kind: 'conversation',
          conversationId: meta.id,
          agentId: meta.agentId,
          conversationMeta: meta,
          onResume: handleResumeConversation,
        },
      };
      editorState.addTab(tab);
      editorState.activateTab(tabKey!, tabId);
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
      onChatResumeConversation={handleChatResumeConversation}
      canChatResume={canChatResume}
      onDeleteConversation={handleDeleteConversation}
    />
  );
});
ConversationsPanelWrapper.displayName = 'ConversationsPanelWrapper';

export default ConversationsPanelWrapper;
export { ConversationsPanelWrapper };

import { useCallback, useEffect, useRef, useState } from 'react';

import { readFileContent, readDirTree } from '@/features/file/api/fileApi';
import { useEditorStore } from '@/shared/store/editorStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { FileNode } from '@/shared/types';
import type { AgentChatTabData } from '@/shared/types/tab';
import { getFileName, getTabId } from '@/shared/utils/fileTree';
import { resolveTabKey } from '@/shared/utils/tabKey';

import { useAgentChat } from '../hooks/useAgentChat';

import ApprovalPanel from './ApprovalPanel';
import ChatComposer from './ChatComposer';
import MessageList from './MessageList';
import ProposedPlanCard from './ProposedPlanCard';
import ResumeList from './ResumeList';
import UserInputPanel from './UserInputPanel';

export { clearMessageCache } from './messageCache';

interface AgentChatTabViewProps {
  tabKey: string;
  tabId: string;
  projectId: string;
  data: AgentChatTabData;
  /** 是否启用 mock 模式（开发/演示用）。 */
  mockMode?: boolean;
}

export default function AgentChatTabView({
  tabKey,
  tabId,
  projectId,
  data,
  mockMode = false,
}: AgentChatTabViewProps) {
  const {
    messages,
    streaming,
    pendingApproval,
    pendingUserInput,
    proposedPlan,
    contextWindow,
    ctxInfo,
    input,
    setInput,
    attachments,
    removeAttachment,
    agentMode,
    setAgentMode,
    thinkingLevel,
    setThinkingLevel,
    fileCount,
    skillCount,
    chatAgents,
    models,
    selectedModel,
    setSelectedModel,
    selectedAgent,
    handleSend,
    handleApproval,
    handleAllowSession,
    handleCancelTurn,
    handleUserInput,
    handleStop,
    resumableList,
    resumableLoading,
    loadResumableList,
    restoreConversation,
    startFreshSession,
  } = useAgentChat({ tabKey, tabId, projectId, data, mockMode });

  const activeWorktreePath = useWorktreeStore((s) => s.activeWorktreePath);
  const [attachFiles, setAttachFiles] = useState<FileNode[]>([]);
  const [attachFilesLoading, setAttachFilesLoading] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  /// 滚动容器（.wa-chat）—— MessageList 虚拟器据此计算可见窗口
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  /// 程序化滚动保护 — 防止用户手动滚动时被自动跟随打断
  const programmaticScrollUntilRef = useRef(0);
  /// 上一条消息数量 — 仅真实消息变化时触发自动跟随
  const messageCountRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    // 自动跟随信号 — 仅基于真实消息变化（对齐 Synara §14.11）
    const currentCount = messages.length;
    const shouldFollow = currentCount > messageCountRef.current;
    messageCountRef.current = currentCount;

    if (shouldFollow) {
      // 程序化滚动保护窗口
      programmaticScrollUntilRef.current = Date.now() + 100;
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  // 空会话态拉取可恢复列表（仅 opencode 类支持接续的 agent 有意义，失败静默）
  const emptyChat = messages.length === 0 && !streaming && !pendingApproval && !pendingUserInput;
  useEffect(() => {
    if (emptyChat) void loadResumableList();
  }, [emptyChat, loadResumableList]);

  /** 点击 read_file 路径 → 在编辑器打开该文件（复用 editorStore + readFileContent，对齐 terminalLinks）。 */
  const openAgentFile = useCallback(
    (filePath: string) => {
      void (async () => {
        const tabKey = resolveTabKey(projectId, activeWorktreePath ?? undefined);
        const tabId = getTabId(tabKey, filePath);
        const existing = useEditorStore.getState().tabs[tabKey];
        if (existing?.tabs.some((t) => t.id === tabId)) {
          useEditorStore.getState().activateTab(tabKey, tabId);
          return;
        }
        try {
          const content = await readFileContent(projectId, filePath);
          useEditorStore.getState().addTab(tabKey, {
            id: tabId,
            projectId,
            title: getFileName(filePath),
            order: existing?.tabs.length ?? 0,
            data: {
              kind: 'file',
              filePath,
              fileName: getFileName(filePath),
              content,
              isDirty: false,
            },
          });
        } catch {
          // 读取失败时忽略：不阻塞流式渲染，等待下一次事件或手动重试。
        }
      })();
    },
    [projectId, activeWorktreePath],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      const ta = e.target;
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    },
    [setInput],
  );

  const openAttachDrop = useCallback(() => {
    if (attachFiles.length === 0 && !attachFilesLoading) {
      setAttachFilesLoading(true);
      void readDirTree(projectId, null, null, 3, [
        'node_modules',
        '.git',
        'dist',
        'target',
        'build',
        'out',
      ])
        .then((tree) => setAttachFiles(tree))
        .catch(() => setAttachFiles([]))
        .finally(() => setAttachFilesLoading(false));
    }
  }, [projectId, attachFiles.length, attachFilesLoading]);

  return (
    <div className="wa-root" data-testid="agent-chat-tab">
      <div className="wa-chat scrollbar" ref={chatScrollRef}>
        <div className="wa-inner">
          <div className="wa-sys" title={ctxInfo?.projectPath ?? ''}>
            <span className="sys-dot" />
            <span>
              会话已开始 · 已注入上下文：{ctxInfo?.projectName ?? projectId}（
              {ctxInfo?.env ?? '本地'}）
              {ctxInfo?.projectPath ? (
                <>
                  {' · '}
                  <span className="wa-sys-cwd">{ctxInfo.projectPath}</span>
                </>
              ) : null}
              {attachments.length > 0 ? ` + ${skillCount} skills + ${fileCount} 文件附件` : ''}
            </span>
          </div>

          <MessageList messages={messages} onOpenFile={openAgentFile} scrollRef={chatScrollRef} />

          {emptyChat && (
            <ResumeList
              items={resumableList}
              loading={resumableLoading}
              onRestore={(meta) => void restoreConversation(meta)}
              onNewSession={startFreshSession}
            />
          )}

          {streaming && (
            <div className="working-indicator">
              <div className="working-dot" />
              <span>Thinking...</span>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>
      </div>

      {/* 审批 / 澄清 / 计划面板固定在滚动区外、composer 上方：
          长会话时不随消息流滚走，始终可见可决策 */}
      {pendingApproval && (
        <ApprovalPanel
          pending={pendingApproval}
          onApprove={(allow) => void handleApproval(allow)}
          onAllowSession={handleAllowSession}
          onCancelTurn={handleCancelTurn}
        />
      )}

      {pendingUserInput && (
        <UserInputPanel
          prompt={pendingUserInput.prompt}
          options={pendingUserInput.options ?? []}
          onSubmit={(selected) => void handleUserInput(selected[0] ?? '')}
        />
      )}

      {proposedPlan && <ProposedPlanCard plan={proposedPlan} />}

      <ChatComposer
        input={input}
        attachments={attachments}
        streaming={streaming}
        agentMode={agentMode}
        thinkingLevel={thinkingLevel}
        chatAgents={chatAgents}
        models={models}
        selectedModel={selectedModel}
        selectedAgent={selectedAgent}
        contextWindow={contextWindow}
        tabKey={tabKey}
        tabId={tabId}
        onInputChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onSend={() => void handleSend()}
        onStop={handleStop}
        onRemoveAttachment={removeAttachment}
        onOpenAttachDrop={openAttachDrop}
        onAgentModeChange={setAgentMode}
        onThinkingLevelChange={setThinkingLevel}
        onModelChange={setSelectedModel}
      />
    </div>
  );
}

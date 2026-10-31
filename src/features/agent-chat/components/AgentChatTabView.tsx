import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useScrollbarCompensation } from '@/shared/hooks/useScrollbarCompensation';
import { useProjectStore } from '@/shared/store/projectStore';
import type { FileNode } from '@/shared/types';
import type { AgentChatTabData } from '@/shared/types/tab';
import {
  workspaceRootOf,
  type ProjectId,
  type WorkspaceSession,
} from '@/shared/utils/workspaceRef';

import { useAgentChat } from '../hooks/useAgentChat';
import { useAgentInputRegistration } from '../hooks/useAgentInputRegistration';
import { useChatAutoFollow } from '../hooks/useChatAutoFollow';
import { useComposerSources } from '../hooks/useComposerSources';
import { useOpenAgentFile } from '../hooks/useOpenAgentFile';
import { useWorkingStatus } from '../hooks/useWorkingStatus';
import { envLabelOf, unitDisplayName } from '../utils/sessionContextLabel';

import ApprovalPanel from './ApprovalPanel';
import AttachFilePicker from './AttachFilePicker';
import ChatComposer from './ChatComposer';
import { insertIntoComposer } from './composer/editorRegistry';
import MessageList from './MessageList';
import ProposedPlanCard from './ProposedPlanCard';
import ResumeList from './ResumeList';
import UserInputPanel from './UserInputPanel';
import WorkingIndicator from './WorkingIndicator';

export { clearMessageCache } from './messageCache';

interface AgentChatTabViewProps {
  tabKey: string;
  /** 本 tab 的 Workspace 地址本体（登记投递接收端用；不得从 tabKey 反解，红线 12）。 */
  session: WorkspaceSession;
  tabId: string;
  projectId: ProjectId;
  data: AgentChatTabData;
  /** 是否启用 mock 模式（开发/演示用）。 */
  mockMode?: boolean;
}

export default function AgentChatTabView({
  tabKey,
  session,
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
    skillCount,
    chatAgents,
    models,
    selectedModel,
    selectModel,
    sessionConfigOptions,
    modelAvailability,
    handleSetConfigOption,
    commandsEnabled,
    selectedAgent,
    handleSend,
    handleApproval,
    handleAllowSession,
    turnStartRef,
    turnToolsRef,
    handleCancelTurn,
    handleUserInput,
    handleStop,
    resumableList,
    resumableLoading,
    loadResumableList,
    restoreConversation,
  } = useAgentChat({ tabKey, tabId, projectId, workspace: session, data, mockMode });

  // agent 消息/提及的拼根基准 = **当前视图单元的工作树根**（worktree 单元 = 工作树根）。
  // 直接取 tab 的地址本体，不再用 `project.path`（那是主仓根，worktree 视图会拼错文件）。
  const projectRoot = useProjectStore(
    (s) => s.projects.find((p) => p.id === projectId)?.path ?? '',
  );
  const projectPath = workspaceRootOf(session.key, projectRoot);
  const ctxEnvLabel = envLabelOf(ctxInfo?.env);
  const [attachPickerOpen, setAttachPickerOpen] = useState(false);

  // 补全弹层数据源（slash 命令 / @ 文件提及）与文件树加载的整体装配，
  // 见 useComposerSources（能力位门控 + 只拉一次的文件树，@ 提及与附件弹窗共用）。
  const {
    sources: composerSources,
    attachFiles,
    attachFilesLoading,
    loadAttachFiles,
  } = useComposerSources({
    projectId,
    commandsEnabled,
    agentId: selectedAgent.id,
    // 项目级命令（opencode `<project>/.opencode/commands/**`）靠它才被发现
    projectPath,
  });

  // 回合指示器数据源（时长 + 活动工具）：从 turnStream 的 ref 账本派生。
  const working = useWorkingStatus(streaming, turnStartRef, turnToolsRef);

  // 消息流自动跟随滚动（refs + 保护窗的纯滚动关注点，见该 hook）。
  const { chatEndRef, chatScrollRef } = useChatAutoFollow(messages.length);
  // 经典滚动条只占右侧：按实测占位减右内边（.wa-chat 的 padding 是基线）
  useScrollbarCompensation(chatScrollRef);

  // 空会话态拉取可恢复列表（仅 opencode 类支持接续的 agent 有意义，失败静默）
  const emptyChat = messages.length === 0 && !streaming && !pendingApproval && !pendingUserInput;
  useEffect(() => {
    if (emptyChat) void loadResumableList();
  }, [emptyChat, loadResumableList]);

  /// 「恢复上次对话」列表展开状态 —— 开关并入 wa-sys 状态栏行（右侧按钮）。
  /// 默认折叠：新建 agent chat / 重新进入空会话态时保持收起。
  /// 用 render 期状态调整（React 官方模式）替代 effect，避免 setState-in-effect
  /// 级联渲染：仅在 emptyChat 由 false → true 时重置收起。
  const [resumeOpen, setResumeOpen] = useState(false);
  const [prevEmptyChat, setPrevEmptyChat] = useState(emptyChat);
  if (prevEmptyChat !== emptyChat) {
    setPrevEmptyChat(emptyChat);
    if (emptyChat) setResumeOpen(false);
  }

  // 登记本 composer 为 agent 投递的接收端（Q1=(a) · Q5=A，详见该 hook 的 docstring）。
  useAgentInputRegistration({ session, tabId });

  const openAgentFile = useOpenAgentFile({ projectId, projectPath });

  /**
   * 「Attach files」按钮：读项目文件树并**打开选择弹窗**。
   *
   * 旧实现只把树读进 state、从不渲染，于是按钮点完毫无反应 —— 整条附件链路
   *（chips / 移除 / 随 prompt 发送）都在，唯独缺「选哪个文件」这一步。
   */
  const openAttachDrop = useCallback(() => {
    setAttachPickerOpen(true);
    loadAttachFiles();
  }, [loadAttachFiles]);

  /**
   * 「Attach files」选中文件 → **插入编辑器文本**（与 `@` 提及同一条路径）。
   *
   * B 方案下文件没有独立的附件 state：唯一表示是编辑器文档（chip / `@path` 文本），
   * 请求的 `files` 由文档投影得出。因此按钮与 `@` 提及在这里汇合 —— 两个入口，
   * 一份事实。
   */
  const handlePickFile = useCallback(
    (file: FileNode) => {
      insertIntoComposer(tabKey, tabId, `@${file.path}`);
      setAttachPickerOpen(false);
    },
    [tabKey, tabId],
  );

  return (
    <div className="wa-root" data-testid="agent-chat-tab">
      {/* 右内边补偿由 useScrollbarCompensation 按实测占位调整（见该 hook 注释） */}
      <div className="wa-chat" ref={chatScrollRef}>
        <div className="wa-inner">
          <div className="wa-sys" title={ctxInfo?.cwd ?? ''}>
            <span className="sys-dot" />
            <span className="wa-sys-text">
              会话已开始 · 已注入上下文：
              {unitDisplayName({
                projectName: ctxInfo?.projectName,
                projectId,
                workspaceKey: ctxInfo?.workspaceKey,
              })}
              {ctxEnvLabel ? `（${ctxEnvLabel}）` : ''}
              {ctxInfo?.cwd ? (
                <>
                  {' · '}
                  <span className="wa-sys-cwd">{ctxInfo.cwd}</span>
                </>
              ) : null}
              {skillCount > 0 ? ` + ${skillCount} skills` : ''}
            </span>
            {emptyChat && (
              <button
                type="button"
                className="resume-toggle"
                onClick={() => setResumeOpen((v) => !v)}
                aria-expanded={resumeOpen}
                aria-controls="resume-list"
                title={resumeOpen ? '收起最近会话' : '展开最近会话'}
              >
                <ChevronRight
                  size={12}
                  className={`resume-toggle-chevron${resumeOpen ? ' open' : ''}`}
                />
                <span>恢复上次对话</span>
              </button>
            )}
          </div>

          <MessageList messages={messages} onOpenFile={openAgentFile} scrollRef={chatScrollRef} />

          {emptyChat && resumeOpen && (
            <ResumeList
              items={resumableList}
              loading={resumableLoading}
              onRestore={(meta) => void restoreConversation(meta)}
            />
          )}

          {streaming && (
            <WorkingIndicator durationMs={working.durationMs} activeTool={working.activeTool} />
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
        legacyInput={input}
        streaming={streaming}
        chatAgents={chatAgents}
        models={models}
        sessionConfigOptions={sessionConfigOptions}
        sessionConfigView={modelAvailability}
        selectedModel={selectedModel}
        selectedAgent={selectedAgent}
        contextWindow={contextWindow}
        tabKey={tabKey}
        tabId={tabId}
        sources={composerSources}
        onSend={(submission) => void handleSend(submission)}
        onStop={handleStop}
        onOpenAttachDrop={openAttachDrop}
        onModelChange={selectModel}
        onConfigChange={handleSetConfigOption}
      />
      {attachPickerOpen && (
        <AttachFilePicker
          files={attachFiles}
          loading={attachFilesLoading}
          attached={[]}
          onPick={handlePickFile}
          onClose={() => setAttachPickerOpen(false)}
        />
      )}
    </div>
  );
}

import React, { useCallback } from 'react';

import { AgentChatTabView } from '@/features/agent-chat';
import { TeamBoardCenterView, TeamTaskCenterView } from '@/features/agent-team';
import { BrowserTabView } from '@/features/browser';
import { ConversationViewer } from '@/features/conversation';
import { ConflictView, DiffView, PRDetailView } from '@/features/git';
import { SplitLayout, TerminalView } from '@/features/terminal';
import { useEditorStore } from '@/shared/store/editorStore';
import type { AgentConfig, AuthMethod, DiffSource } from '@/shared/types';
import type { DiffMode } from '@/shared/types/settings';
import type { Tab } from '@/shared/types/tab';
import { requireTabWorkspaceSession, tabSpaceKeyOf } from '@/shared/utils/tabIdentity';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import FileViewer from './FileViewer';
import HtmlPreview from './HtmlPreview';

interface PaneContentProps {
  tabKey: string;
  activeTab: Tab | null;
  agents: AgentConfig[];
  diffMode: DiffMode;
  layoutId: string;
  /** 本 pane 是否为当前激活组（left/right/pinned 中只有一个为 true）。 */
  isActiveGroup: boolean;
  remoteProject?: {
    entryId: string;
    projectId: ProjectId;
    projectName: string;
    projectPath: string;
    host: string;
    port: number;
    username: string;
    auth: AuthMethod;
    onSessionReady?: (pid: string) => void;
  } | null;
  onCloseTab: (tabId: string) => void;
  showToast: (message: string, type?: 'info' | 'error') => void;
  onSplitStateChange: (info: import('@/features/terminal').SplitStateInfo) => void;
  onSetSplitHorizontal: (cb: () => void) => void;
  onSetSplitVertical: (cb: () => void) => void;
  onSetClosePane: (cb: () => void) => void;
}

/**
 * 编辑器面板内容区：按 activeTab 类型分发会话 / 终端 / Diff / 文件 / HTML 预览 / PR 详情 / Browser。
 */
function PaneContent({
  tabKey,
  activeTab,
  agents,
  diffMode,
  layoutId,
  isActiveGroup,
  remoteProject,
  onCloseTab,
  showToast,
  onSplitStateChange,
  onSetSplitHorizontal,
  onSetSplitVertical,
  onSetClosePane,
}: PaneContentProps) {
  /**
   * 看板 tab 的 board/flow 选择**写回 tab 数据**（`activeTab.data.view`）。
   *
   * 由本层注入而不是让 `TeamBoardCenterView` 自己写 store：团队组件属于
   * `features/agent-team`，`editorStore` 属于编辑器域 —— 跨域直写是导入防火墙要挡的那类耦合。
   * `PaneContent` 本来就是「tab 数据 → 视图 props」的适配层，且它已经握着 tab 空间键与 tab id。
   *
   * 注入的函数必须身份稳定（`TeamBoardCenterView` 是 `React.memo`）：内联箭头会在每次渲染
   * 造一个新闭包，把 memo 白掉。依赖只有 `activeTab`（tab 数据变了本来就要重渲染）。
   */
  const handleTeamBoardViewChange = useCallback(
    (view: 'board' | 'flow') => {
      if (!activeTab) return;
      useEditorStore
        .getState()
        .updateTab(tabSpaceKeyOf(activeTab.scope), activeTab.id, { kind: 'team-board', view });
    },
    [activeTab],
  );

  if (!activeTab) return null;

  // 以下各 kind 的 props 均要求必有项目（这些 tab 只在 workspace 空间创建）——
  // 经不变量收窄取 session 本体（不制造伪身份、不用非空断言）；项目粒度由它投影。
  const tabSession = requireTabWorkspaceSession(activeTab);
  const projectId = tabSession.projectId;
  // tab 空间键显式下传（TerminalView 不再从缓存键解析身份）
  const tabSpaceKey = tabSpaceKeyOf(activeTab.scope);

  const handleOpenDiff = (filePath: string) => {
    const tabId = `tab_${crypto.randomUUID()}`;
    const diffSource: DiffSource = {
      workspace: requireTabWorkspaceSession(activeTab),
      revision: { type: 'worktree' },
    };
    // 显式标注 `Tab`：让 tsc 对字面量做 excess-property 检查（推断成裸对象会绕过它，
    // 曾因此漏掉已删除的 `order` 字段）。顺序由布局 `tabIds` 表达，`Tab` 不再有 `order`。
    const tab: Tab = {
      id: tabId,
      scope: activeTab.scope,
      title: filePath.split('/').pop() || filePath,
      data: {
        kind: 'diff' as const,
        filePath,
        fileName: filePath.split('/').pop() || filePath,
        diffSource,
      },
    };
    useEditorStore.getState().addTab(tab);
    useEditorStore.getState().activateTab(tabKey, tabId);
  };

  switch (activeTab.data.kind) {
    case 'conversation':
      return (
        <ConversationViewer
          conversationId={activeTab.data.conversationId}
          agentId={activeTab.data.agentId}
          projectId={projectId}
          conversationMeta={activeTab.data.conversationMeta ?? null}
          agents={agents}
          onBack={() => onCloseTab(activeTab.id)}
          onResume={activeTab.data.onResume}
          showToast={showToast}
        />
      );
    case 'terminal':
      return (
        <div className="terminal-pane-container flex-1 flex flex-row overflow-hidden min-h-0 p-0 m-0">
          <SplitLayout
            layoutId={layoutId}
            renderPane={(paneId) =>
              remoteProject ? (
                <TerminalView
                  paneId={paneId}
                  remoteConfig={remoteProject}
                  tabSpaceKey={tabSpaceKey}
                />
              ) : (
                <TerminalView paneId={paneId} tabSpaceKey={tabSpaceKey} />
              )
            }
            onSplitStateChange={onSplitStateChange}
            onSplitHorizontal={onSetSplitHorizontal}
            onSplitVertical={onSetSplitVertical}
            onClosePane={onSetClosePane}
          />
        </div>
      );
    case 'diff':
      // 修订维度二选一：冲突（index unmerged stages）→ 三侧只读视图；其余 → 既有 DiffView（零改动）。
      if (activeTab.data.diffSource.revision.type === 'conflict') {
        return (
          <ConflictView
            workspace={tabSession}
            filePath={activeTab.data.filePath}
            onBack={() => onCloseTab(activeTab.id)}
            onShowToast={showToast}
          />
        );
      }
      return (
        <DiffView
          projectId={projectId}
          diffSource={activeTab.data.diffSource}
          filePath={activeTab.data.filePath}
          initialMode={diffMode}
          onBack={() => onCloseTab(activeTab.id)}
          combined={activeTab.data.combined}
          files={activeTab.data.combinedFiles}
          scrollToPath={activeTab.data.scrollToPath}
        />
      );
    case 'file':
      return <FileViewer />;
    case 'html-preview':
      return (
        <HtmlPreview
          projectId={projectId}
          filePath={activeTab.data.filePath}
          fileName={activeTab.data.fileName}
        />
      );
    case 'prDetail':
      return (
        <PRDetailView
          key={activeTab.data.prNumber}
          projectId={projectId}
          prNumber={activeTab.data.prNumber}
          prTitle={activeTab.data.prTitle}
          prState={activeTab.data.prState}
          prBody={activeTab.data.prBody}
          prAuthor={activeTab.data.prAuthor}
          prCreatedAt={activeTab.data.prCreatedAt}
          prUrl={activeTab.data.prUrl}
          prHeadRef={activeTab.data.prHeadRef}
          prBaseRef={activeTab.data.prBaseRef}
          onClose={() => onCloseTab(activeTab.id)}
          onOpenDiff={handleOpenDiff}
        />
      );
    case 'agent-chat':
      return (
        <AgentChatTabView
          key={activeTab.id}
          tabKey={tabKey}
          session={tabSession}
          tabId={activeTab.id}
          projectId={projectId}
          data={activeTab.data}
        />
      );
    case 'browser':
      return (
        <BrowserTabView
          tabKey={tabKey}
          tabId={activeTab.id}
          projectId={projectId}
          isActive={isActiveGroup}
        />
      );
    case 'team-board':
      return (
        <TeamBoardCenterView
          key={activeTab.id}
          teamId={activeTab.data.teamId}
          view={activeTab.data.view}
          projectId={projectId}
          onViewChange={handleTeamBoardViewChange}
        />
      );
    case 'team-task':
      return (
        <TeamTaskCenterView
          key={activeTab.id}
          teamId={activeTab.data.teamId}
          taskId={activeTab.data.taskId}
        />
      );
    default:
      return null;
  }
}

export default React.memo(PaneContent);

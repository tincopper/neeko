import React from 'react';

import { ConversationViewer } from '@/features/conversation';
import { DiffView, PRDetailView } from '@/features/git';
import { SplitLayout, TerminalView } from '@/features/terminal';
import { useEditorStore } from '@/shared/store/editorStore';
import type { AgentConfig, AuthMethod } from '@/shared/types';
import type { DiffMode } from '@/shared/types/settings';
import type { Tab } from '@/shared/types/tab';
import { buildDiffSource } from '@/shared/utils/diffSource';

import FileViewer from './FileViewer';
import HtmlPreview from './HtmlPreview';

interface PaneContentProps {
  tabKey: string;
  activeTab: Tab | null;
  agents: AgentConfig[];
  diffMode: DiffMode;
  layoutId: string;
  remoteProject?: {
    entryId: string;
    projectId: string;
    projectName: string;
    projectPath: string;
    host: string;
    port: number;
    username: string;
    auth: AuthMethod;
    cacheKeySuffix?: string;
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
 * 编辑器面板内容区：按 activeTab 类型分发会话 / 终端 / Diff / 文件 / HTML 预览 / PR 详情。
 */
function PaneContent({
  tabKey,
  activeTab,
  agents,
  diffMode,
  layoutId,
  remoteProject,
  onCloseTab,
  showToast,
  onSplitStateChange,
  onSetSplitHorizontal,
  onSetSplitVertical,
  onSetClosePane,
}: PaneContentProps) {
  if (!activeTab) return null;

  const handleOpenDiff = (filePath: string) => {
    const tabId = `tab_${crypto.randomUUID()}`;
    const diffSource = buildDiffSource(null, null);
    const tab = {
      id: tabId,
      projectId: activeTab.projectId,
      title: filePath.split('/').pop() || filePath,
      order: 0,
      data: {
        kind: 'diff' as const,
        filePath,
        fileName: filePath.split('/').pop() || filePath,
        diffSource,
      },
    };
    useEditorStore.getState().addTab(tabKey, tab);
    useEditorStore.getState().activateTab(tabKey, tabId);
  };

  switch (activeTab.data.kind) {
    case 'conversation':
      return (
        <ConversationViewer
          conversationId={activeTab.data.conversationId}
          agentId={activeTab.data.agentId}
          projectId={activeTab.projectId}
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
                <TerminalView paneId={paneId} remoteConfig={remoteProject} />
              ) : (
                <TerminalView paneId={paneId} />
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
      return (
        <DiffView
          projectId={activeTab.projectId}
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
          projectId={activeTab.projectId}
          filePath={activeTab.data.filePath}
          fileName={activeTab.data.fileName}
        />
      );
    case 'prDetail':
      return (
        <PRDetailView
          key={activeTab.data.prNumber}
          projectId={activeTab.data.projectId}
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
    default:
      return null;
  }
}

export default React.memo(PaneContent);

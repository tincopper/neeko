import React, { useCallback } from 'react';

import { useEditorContext } from '@/shared/contexts';
import { useEditorStore } from '@/shared/store/editorStore';
import type { AuthMethod } from '@/shared/types';

import { useTerminalStrategy } from '../strategies';

import TerminalViewBase from './TerminalViewBase';

export interface TerminalViewProps {
  paneId: string;
  /** 该 pane 所属 tab 的空间键（`WorkspaceSession#key`）；由 PaneContent 显式下传。 */
  tabSpaceKey?: string;
  /** Remote-specific configuration. Required when the active project is Remote. */
  remoteConfig?: {
    entryId: string;
    host: string;
    port: number;
    username: string;
    auth: AuthMethod;
    onSessionReady?: (pid: string) => void;
  };
}

function TerminalView({ paneId, tabSpaceKey, remoteConfig }: TerminalViewProps) {
  const { activeTabId = null, tabs } = useEditorContext();
  const strategy = useTerminalStrategy({
    paneId,
    remoteConfig,
  });

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const tabAgentId = activeTab?.agentId ?? null;

  // Task terminal fields — read from full Tab data in editorStore
  const fullTabData = useEditorStore((s) => {
    if (!tabSpaceKey || !activeTabId) return null;
    const pt = s.tabs[tabSpaceKey];
    return pt?.tabs.find((t) => t.id === activeTabId)?.data ?? null;
  });
  const taskCommand = fullTabData?.kind === 'terminal' ? (fullTabData.taskCommand ?? null) : null;
  const taskConfigId = fullTabData?.kind === 'terminal' ? (fullTabData.taskConfigId ?? null) : null;
  const taskRebuildKey = fullTabData?.kind === 'terminal' ? (fullTabData.rebuildKey ?? 0) : 0;

  /**
   * PTY 创建成功 → 把后端铸造的 session id 写进 tab data。
   *
   * 它是侧栏会话行与 tab 的**唯一映射键**（`tabSession` / `sessionTab` 双向都用它）。
   * 只写一次身份，不写状态：状态属于注册表，视图持有副本就是本任务要消灭的形态。
   */
  const handleSessionCreated = useCallback(
    (sessionId: string) => {
      if (!tabSpaceKey || !activeTabId) return;
      useEditorStore.getState().updateTab(tabSpaceKey, activeTabId, { ptySessionId: sessionId });
    },
    [tabSpaceKey, activeTabId],
  );

  if (!strategy) return null;

  return (
    <TerminalViewBase
      strategy={strategy}
      tabAgentId={tabAgentId}
      activeTabId={activeTabId}
      taskCommand={taskCommand}
      taskConfigId={taskConfigId}
      taskRebuildKey={taskRebuildKey}
      onSessionCreated={handleSessionCreated}
    />
  );
}

export default React.memo(TerminalView);

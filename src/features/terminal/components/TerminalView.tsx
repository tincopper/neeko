import React, { useCallback } from 'react';

import { setLiveSessionTitle } from '@/features/live-sessions/api/liveSessionsApi';
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

  /**
   * 终端自报的原生标题（xterm OSC 0/2）→ 注册表 `TitleSource::Native`。
   *
   * 走薄命令而不是新事件：前端→后端的既有通道只有 `terminal-input-{id}`（载荷是
   * stdin 字节）与 agent chat（反向），两者都得新造通道名才能载标题（红线 5）。
   * 单调升级（OSC 标题不得覆盖用户改名）由后端 `title::should_upgrade` 把关，
   * 这里不做第二次判断。失败静默：标题是旁路，不能打断终端。
   */
  const handleSessionTitleChange = useCallback((sessionId: string, title: string) => {
    // 静默豁免：标题回传，尽力而为，失败无需上报
    setLiveSessionTitle(sessionId, title).catch(() => {});
  }, []);

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
      onSessionTitleChange={handleSessionTitleChange}
    />
  );
}

export default React.memo(TerminalView);

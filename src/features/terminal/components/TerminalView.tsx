import React, { useCallback, useEffect } from 'react';

import { adoptLiveSession } from '@/features/live-sessions/api/liveSessionsApi';
import { useEditorContext } from '@/shared/contexts';
import { registerInsertPort, unregisterInsertPort } from '@/shared/inputs/insertPorts';
import { useEditorStore } from '@/shared/store/editorStore';
import { selectActiveTabId } from '@/shared/store/editorTabSelectors';
import type { AuthMethod } from '@/shared/types';
import type { TerminalTabData } from '@/shared/types/tab';

import { useTerminalStrategy } from '../strategies';

import { pasteToTerminalSession } from './terminalCommands';
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
   * 接回一条还活着的会话（关 tab 时选了「后台运行」）。
   *
   * 只用 tab 上显式打的标记，**不拿 `ptySessionId` 反推**：那个字段在每次新建会话后都会
   * 变化，用它会把这个 effect 变成「会话一建好就重跑一遍」。活着与否由
   * `TerminalViewBase` 向后端探一次，探不到就照常新建。
   */
  const attachSessionId =
    fullTabData?.kind === 'terminal' ? (fullTabData.attachSessionId ?? null) : null;

  /**
   * 纯 shell 恢复目标。判据只有一处：tab data 上的 `resumeFromSessionId`
   * （后端按 `agent_id` 单点裁决是否落盘，前端不再自己判「纯 shell」）。
   */
  const resumeFrom =
    fullTabData?.kind === 'terminal' ? (fullTabData.resumeFromSessionId ?? null) : null;

  const strategy = useTerminalStrategy({ paneId, remoteConfig });

  /**
   * 终端插入端口 —— **每个渲染中的 pane 一个**，`insert` 用**本 pane 自己那条 PTY 的
   * sessionId**（`strategy.cache.get(strategy.cacheKey)`）。
   *
   * 这是 2026-11 那次「拖文件到终端什么都没发生」的结构性修法：旧实现由投递方按
   * `paneId = 'p1'` 猜 PTY，终端只要不在第一个 pane（右侧 dock / 分屏）就必然 miss。
   * 现在 pane 身份由**渲染方**自己带着登记，「猜 paneId」这一步不存在。
   *
   * `el` 是**惰性投影**（getter）：终端 DOM 由 `TerminalViewBase` 在字体门闩之后创建，
   * 登记时通常还不存在；指针 / 焦点判据因此每次都读当前那一个，不需要重挂。
   * `isActive` 用布局派生的前台 tab（唯一真源 `editorTabSelectors`），不另造口径。
   */
  useEffect(() => {
    if (!strategy || !tabSpaceKey) return;
    const { cache, cacheKey } = strategy;
    const portId = `terminal:${cacheKey}`;
    registerInsertPort({
      id: portId,
      kind: 'terminal',
      sessionKey: tabSpaceKey,
      get el() {
        return cache.get(cacheKey)?.element ?? null;
      },
      isActive: () => selectActiveTabId(useEditorStore.getState(), tabSpaceKey) === activeTabId,
      insert: (text) => {
        // PTY 未就绪（entry 还没建 / sessionId 还是 null）→ false，仲裁继续降级。
        const entry = cache.get(cacheKey);
        if (!entry?.sessionId) return false;
        pasteToTerminalSession(entry.sessionId, text);
        return true;
      },
    });
    return () => unregisterInsertPort(portId);
  }, [strategy, tabSpaceKey, activeTabId]);

  /**
   * PTY 创建成功 → 把后端铸造的 session id 写进 tab data。
   *
   * 它是侧栏会话行与 tab 的**唯一映射键**（`tabSession` / `sessionTab` 双向都用它）。
   * 只写一次身份，不写状态：状态属于注册表，视图持有副本就是本任务要消灭的形态。
   */
  const handleSessionCreated = useCallback(
    (sessionId: string) => {
      if (!tabSpaceKey || !activeTabId) return;
      const editor = useEditorStore.getState();
      const data = editor.tabs[tabSpaceKey]?.tabs.find((tab) => tab.id === activeTabId)?.data;
      const resumeFrom = data?.kind === 'terminal' ? data.resumeFromSessionId : undefined;
      // 一次性消费恢复标记：PTY 可能因缓存失效 / pane 切换 / 重挂载被重建，
      // 留着它会拿同一个 from 反复 adopt，每次都在库里多留一行同 native id 的会话。
      editor.updateTab(tabSpaceKey, activeTabId, {
        ptySessionId: sessionId,
        ...(resumeFrom ? { resumeFromSessionId: undefined } : {}),
      } as Partial<TerminalTabData>);
      // 恢复出来的 PTY 是旧会话的**延续**：继承标题与「已使用」，旧条目退场。
      // 不继承的话，新会话要等用户敲第一条输入才会被侧栏列出 —— 那一行会先消失一次。
      if (resumeFrom) {
        void adoptLiveSession(resumeFrom, sessionId).catch(() => undefined);
      }
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
      attachSessionId={attachSessionId}
      resumeFrom={resumeFrom}
      onSessionCreated={handleSessionCreated}
    />
  );
}

export default React.memo(TerminalView);

import { useCallback } from 'react';
import { useShallow } from 'zustand/shallow';

import { useEditorStore } from '@/shared/store/editorStore';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import type { TerminalTab, AgentConfig, Tab, TerminalTabData } from '@/shared/types';
import { requireTabWorkspaceSession } from '@/shared/utils/tabIdentity';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { MAX_TERMINAL_TABS, generateTerminalTabId } from '../api/taskTerminal';
import { closeAllEditorTabs, closeEditorTab } from '../components/terminalTabCleanup';

function generateTabId(): string {
  return generateTerminalTabId();
}

/** Type guard: narrow Tab to terminal kind */
function isTerminalTab(tab: Tab): tab is Tab & { data: TerminalTabData } {
  return tab.data.kind === 'terminal';
}

/** Convert a unified Tab (terminal kind) to legacy TerminalTab */
function tabToTerminalTab(tab: Tab & { data: TerminalTabData }): TerminalTab {
  return {
    id: tab.id,
    projectId: requireTabWorkspaceSession(tab).projectId,
    agentId: tab.data.agentId,
    title: tab.title,
    status: tab.data.status,
  };
}

/**
 * 找一个已经接管着 `sessionId` 的 terminal tab（跨全部 tab 空间）。
 *
 * **session id 是后端全局身份**，不属于任何 workspace 单元 —— 同一条会话在两个 tab 空间
 * 各开一个 tab，两个 tab 会抢同一个 `SessionDrain`（后端缓冲按 session 存、消费即取走），
 * 结果是双方都缺字节。因此判重不能只看目标 tab 空间。
 */
function findTabTakingOver(sessionId: string): { tabKey: string; tab: Tab } | null {
  const { tabs } = useEditorStore.getState();
  for (const [tabKey, projectTabs] of Object.entries(tabs)) {
    for (const tab of projectTabs.tabs) {
      if (tab.data.kind === 'terminal' && tab.data.existingSessionId === sessionId) {
        return { tabKey, tab };
      }
    }
  }
  return null;
}

interface OpenTerminalTabSpec {
  agentId?: string | null;
  /** 显式标题；缺省回落到 agent 名 / `Terminal N`。 */
  title?: string;
  /** 接管既有后端会话（有值时终端不新建 PTY，见 `TerminalTabData.existingSessionId`）。 */
  existingSessionId?: string;
}

export function useTerminalTabs() {
  // Subscribe to the entire tabs record for reactivity
  const storeTabs = useEditorStore(useShallow((state) => state.tabs));

  const getTabs = useCallback(
    (projectId: string): TerminalTab[] => {
      const projectTabs = storeTabs[projectId];
      if (!projectTabs) return [];
      return projectTabs.tabs.filter(isTerminalTab).map(tabToTerminalTab);
    },
    [storeTabs],
  );

  /**
   * 开一个 terminal tab 的**唯一**实现（配额 / 落键 / 标题回落 / 创建即激活只在里做一次）。
   *
   * `addTab` / `openExistingTerminalTab` / `handleAgentClick` 只是不同语义的入口，
   * 都必须走这一处 —— 分开写两份就是让「配额算不算接管 tab」这类问题变成两个答案。
   */
  const openTab = useCallback(
    (projectId: ProjectId, spec: OpenTerminalTabSpec = {}): TerminalTab | null => {
      const state = useEditorStore.getState();
      // 配额与既有 tab 检查按 store 键（= tab.scope 推导键）寻址，与 addTab 落键同形
      const session = activeWorkspaceSession(projectId);
      const existing = state.tabs[session.key];
      const terminalCount = (existing?.tabs ?? []).filter(isTerminalTab).length;
      if (terminalCount >= MAX_TERMINAL_TABS) return null;

      const tabId = generateTabId();
      const title = spec.title ?? spec.agentId ?? `Terminal ${terminalCount + 1}`;
      const data: TerminalTabData = {
        kind: 'terminal',
        agentId: spec.agentId ?? null,
        status: 'Idle',
        ...(spec.existingSessionId ? { existingSessionId: spec.existingSessionId } : {}),
      };
      const newTab: Tab = {
        id: tabId,
        scope: { kind: 'workspace', session },
        title,
        data,
      };

      state.addTab(newTab);
      state.activateTab(session.key, tabId);

      return {
        id: tabId,
        projectId,
        agentId: data.agentId,
        title,
        status: 'Idle',
      };
    },
    [],
  );

  const addTab = useCallback(
    (projectId: ProjectId, agentId?: string | null, agentName?: string): TerminalTab | null =>
      openTab(projectId, { agentId: agentId ?? null, title: agentName }),
    [openTab],
  );

  /**
   * 打开一个**接管既有后端会话**的终端 tab（团队队长/成员用）。
   *
   * 会话由 Rust 侧建好（`start_team_session` → `terminal_id`），前端只负责把它渲染出来：
   * 有 `existingSessionId` 的 tab 在 local 策略下**不会**再发 `create_terminal_session`。
   *
   * **同一 sessionId 已开过 tab 则直接激活那一个**：drain 是 per-session 的单队列，
   * 两个 tab 同时拉会互相偷字节（两边都缺输出）。激活发生在**原 tab 所属的空间**——
   * 若该 tab 在别的 workspace 单元里，调用方（团队入口）负责把那个单元切到前台；
   * 本 hook 只做终端域内的事，不去改项目/工作区激活态。
   */
  const openExistingTerminalTab = useCallback(
    (
      projectId: ProjectId,
      sessionId: string,
      title: string,
      /** 会话所属的 agent（`AgentConfig.id`）：tab 栏据此显示品牌图标 —— 团队成员
       *  的会话由此能看出「是哪个 agent 在跑」，而不是一枚无身份的裸终端。 */
      agentId?: string | null,
    ): TerminalTab | null => {
      if (!sessionId) return null;

      const already = findTabTakingOver(sessionId);
      if (already) {
        useEditorStore.getState().activateTab(already.tabKey, already.tab.id);
        return tabToTerminalTab(already.tab as Tab & { data: TerminalTabData });
      }

      return openTab(projectId, {
        title,
        existingSessionId: sessionId,
        agentId: agentId ?? null,
      });
    },
    [openTab],
  );

  const closeTab = useCallback((projectId: string, tabId: string): void => {
    // Recycle terminal PTY caches then remove the editor tab.
    closeEditorTab(projectId, tabId);
  }, []);

  const activateTab = useCallback((projectId: string, tabId: string): void => {
    useEditorStore.getState().activateTab(projectId, tabId);
  }, []);

  const setTabAgent = useCallback(
    (projectId: string, tabId: string, agentId: string | null, agentName?: string): void => {
      useEditorStore.getState().updateTab(projectId, tabId, {
        agentId,
        title: agentName ?? (agentId ? agentId : 'Terminal'),
      });
    },
    [],
  );

  const updateTabTitle = useCallback((projectId: string, tabId: string, title: string): void => {
    useEditorStore.getState().updateTab(projectId, tabId, { title });
  }, []);

  const updateTabStatus = useCallback(
    (projectId: string, tabId: string, status: TerminalTab['status']): void => {
      useEditorStore.getState().updateTab(projectId, tabId, { status });
    },
    [],
  );

  const handleAgentClick = useCallback(
    (projectId: ProjectId, agent: AgentConfig): TerminalTab | null => {
      // Always create a new tab when clicking an agent
      return addTab(projectId, agent.id, agent.name);
    },
    [addTab],
  );

  const clearProjectTabs = useCallback((projectId: string): void => {
    // Recycle all terminal PTY caches for this tab space then clear tabs.
    closeAllEditorTabs(projectId);
  }, []);

  return {
    getTabs,
    addTab,
    openExistingTerminalTab,
    closeTab,
    activateTab,
    setTabAgent,
    updateTabTitle,
    updateTabStatus,
    handleAgentClick,
    clearProjectTabs,
  };
}

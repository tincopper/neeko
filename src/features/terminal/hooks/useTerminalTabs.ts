import { useCallback } from 'react';
import { useShallow } from 'zustand/shallow';

import { createTerminalTabIn } from '@/features/terminal/api/taskTerminal';
import { useEditorStore } from '@/shared/store/editorStore';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import type { TerminalTab, AgentConfig, Tab, TerminalTabData } from '@/shared/types';
import { generateTabId, requireTabWorkspaceSession } from '@/shared/utils/tabIdentity';
import { MAX_TERMINAL_TABS, nextTerminalTitle } from '@/shared/utils/terminalTabTitle';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { closeAllEditorTabs, closeEditorTab } from '../components/terminalTabCleanup';

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
      if (tab.data.kind === 'terminal' && tab.data.attachSessionId === sessionId) {
        return { tabKey, tab };
      }
    }
  }
  return null;
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

  const addTab = useCallback(
    // 占位标题 = agent 名（初版行为）：会话还没起名时 tab 至少能认出是哪个 agent。
    // 会话真标题到手后由 `resolveTabTitle` 在渲染期覆盖，不写回 tab.title。
    (projectId: ProjectId, agentId?: string | null, agentName?: string): TerminalTab | null => {
      const state = useEditorStore.getState();
      // 配额与既有 tab 检查按 store 键（= tab.scope 推导键）寻址，与 addTab 落键同形
      const session = activeWorkspaceSession(projectId);
      const existing = state.tabs[session.key];
      const terminalCount = (existing?.tabs ?? []).filter(isTerminalTab).length;
      if (terminalCount >= MAX_TERMINAL_TABS) return null;

      const tabId = generateTabId();
      const title = agentName ?? agentId ?? nextTerminalTitle(existing);
      const newTab: Tab = {
        id: tabId,
        scope: { kind: 'workspace', session: activeWorkspaceSession(projectId) },
        title,
        data: {
          kind: 'terminal',
          agentId: agentId ?? null,
        },
      };

      state.addTab(newTab);
      state.activateTab(session.key, tabId);

      return {
        id: tabId,
        projectId,
        agentId: agentId ?? null,
        title,
      };
    },
    [],
  );

  /**
   * 打开一个**接管既有后端会话**的终端 tab（团队队长/成员用）。
   *
   * 会话由 Rust 侧建好（`start_team_session` → `terminal_id`）并已登记进 live-sessions 注册表，
   * 前端只负责把它渲染出来：带 `attachSessionId` 的 tab **不会**再发 `create_terminal_session`，
   * 而是 `attach` 到那条会话，且不拥有它的进程。
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

      // 走终端域的**创建端口**：配额 / id 铸造 / 占位标题 / 创建即激活只有一处实现。
      // 这里只补「接回」这一条身份（`attachSessionId`）—— `TerminalViewBase` 见到它
      // 就跳过 createSession、改走 `attachLiveSession`，且 terminalCache 因 `attached`
      // 不拥有进程，关 tab 不会 kill 团队会话。
      const tabId = createTerminalTabIn(activeWorkspaceSession(projectId), {
        agentId: agentId ?? null,
        title,
        attachSessionId: sessionId,
      });
      if (!tabId) return null;

      return {
        id: tabId,
        projectId,
        agentId: agentId ?? null,
        title,
      };
    },
    [],
  );

  const closeTab = useCallback((projectId: string, tabId: string): void => {
    // Recycle terminal PTY caches then remove the editor tab.
    closeEditorTab(projectId, tabId);
  }, []);

  const activateTab = useCallback((projectId: string, tabId: string): void => {
    useEditorStore.getState().activateTab(projectId, tabId);
  }, []);

  // 换 agent 只改身份，**不改标题**：标题属于会话（注册表），不是 agent 的副本。
  const setTabAgent = useCallback(
    (projectId: string, tabId: string, agentId: string | null): void => {
      useEditorStore.getState().updateTab(projectId, tabId, { agentId });
    },
    [],
  );

  const updateTabTitle = useCallback((projectId: string, tabId: string, title: string): void => {
    useEditorStore.getState().updateTab(projectId, tabId, { title });
  }, []);

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
    handleAgentClick,
    clearProjectTabs,
  };
}

import { useCallback } from 'react';

import { openAgentChatTab } from '@/features/agent-chat/api/openChatTab';
import { useActivateSession } from '@/features/live-sessions';
import {
  DOCK_VIEW_META,
  appViewKey,
  isDockSlot,
  isViewVisible,
  tabHostView,
  type DockSlot,
  type ViewKey,
} from '@/shared/dock';
import { selectLatestSessionForUnit } from '@/shared/selectors/liveSessionSelectors';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import { notify } from '@/shared/store/notificationStore';
import { useProjectStore } from '@/shared/store/projectStore';
import {
  activeWorkspaceSession,
  selectActiveWorkspaceKey,
  useWorkspaceStore,
} from '@/shared/store/workspaceStore';
import type { AgentConfig } from '@/shared/types';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import {
  SESSION_KIND_OF_TAB_KIND,
  findTabOfKind,
  isOpenableTabKind,
  type OpenableTabKind,
} from '../utils/tabKind';
import { moveTabToSlot } from '../utils/tabSurface';

import { useProjectAgents } from './useProjectAgents';

/**
 * 种类级入口（`tabKind:*` 图标）的点击落地 —— `activation.kind === 'openTab'` 的唯一实现。
 *
 * 为什么在 app 层而不是 `dockStore.toggleView`：store 不持有 tab 端口（建 tab 要
 * `editorStore` + 域端口），而且 store 里做「找已有 / 新建 / 移动」会把顺序知识散到
 * 两个模块。`toggleView` 里的 `openTab` 分支因此保持 `return`（见其注释）。
 *
 * 语义（四条，缺一条就会退化成「点了没反应」）：
 * 1. 当前 tab 空间已有该种类 → **激活它**（在停靠宿主里就同时展开宿主；中心区被
 *    Library / Settings 占着就先退出中心视图 —— 否则激活的 tab 看不见）；
 * 2. 没有 tab、但该单元还有**用户真的用过**的同类会话 → 直接交给 live-sessions 的
 *    唯一恢复链（`useActivateSession`：接回存活 PTY / 续写已结束会话 / 补写映射键）；
 * 3. 都没有 → 新建后**立即停靠到图标当前所在的槽**（`placements` 是唯一真源，
 *    `meta.defaultSlot` 只在图标还没落位时兜底）；
 * 4. 无项目 / 无 tab 空间 / 拿不到 agent → 提示，**静默不**。
 *
 * 依赖注入而不是 `useAppContext()`：本 hook 由组合根 `App.tsx` 在 Provider **之外**
 * 装配（与 `useDockBarMove` 同层），Context 在那里不存在。
 */
export interface DockBarOpenTabDeps {
  /** 项目可用的 agent 配置（组合根传 `appValue.agents`）。 */
  agents: AgentConfig[];
  /** agent 终端打开端口（`EditorContext.onAgentClick`，经 `useAgentClickHandler` 建终端 tab）。 */
  onAgentClick: (agent: AgentConfig) => void;
}

export type OpenTabHandler = (view: ViewKey, slot: DockSlot) => void;

/**
 * 中心区被全宽视图占着时先退出 —— 否则「激活一条中心 tab」是静默 no-op。
 * 互斥语义不在这里重写：Library 走 dock 的统一 toggle（同时恢复左栏），Settings 只有一个写入口。
 */
function leaveCenterView(): void {
  const appView = useAppViewStore.getState().appView;
  if (appView === 'library') {
    useDockStore.getState().toggleView(appViewKey('library'));
    return;
  }
  if (appView === 'settings') useAppViewStore.getState().setAppView('normal');
}

/** 让一条已存在的 tab 真正出现在用户眼前（宿主展开 / 退出中心视图）。 */
function revealTab(tabKey: string, tabId: string, dockSlot: DockSlot | null): void {
  if (dockSlot) useDockStore.getState().activateView(tabHostView(dockSlot));
  else leaveCenterView();
  useEditorStore.getState().activateTab(tabKey, tabId);
}

/** 空间里某种类 tab 的 id 集合 —— 用来识别「新建的那条」（创建端口不回传 id）。 */
function tabIdsOfKind(tabKey: string, kind: OpenableTabKind): string[] {
  const tabs = useEditorStore.getState().tabs[tabKey]?.tabs ?? [];
  return tabs.filter((tab) => tab.data.kind === kind).map((tab) => tab.id);
}

/**
 * agent 终端 = 复用既有 agent 打开路径（`useProjectAgents` 的安装态门 + `onAgentClick`），
 * 不新建 PTY 命令。返回新建的 tab id，拿不到就返回 null（配额满 / agent 不可用）。
 */
function openAgentTerminalTab(
  ctx: { tabKey: string; agents: AgentConfig[] },
  handleAgentClick: (agent: AgentConfig) => boolean,
): string | null {
  const agentId = useProjectStore.getState().activeProject?.selected_agents?.[0] ?? null;
  const agent = agentId ? (ctx.agents.find((candidate) => candidate.id === agentId) ?? null) : null;
  if (!agent) {
    notify('Select an agent for this project to open an agent terminal', 'info');
    return null;
  }

  const before = tabIdsOfKind(ctx.tabKey, 'terminal');
  // false = 未安装（`useProjectAgents` 已给出提示）或已禁用（与侧栏 agent 按钮同约定：静默拒绝）
  if (!handleAgentClick(agent)) return null;

  const created = tabIdsOfKind(ctx.tabKey, 'terminal').filter((id) => !before.includes(id));
  // `addTab` 的终端配额门是静默 return —— 走到这里说明用户点了却什么都不会发生，必须解释
  if (created.length === 0) {
    notify('Cannot open another terminal tab', 'error');
    return null;
  }
  return created[created.length - 1];
}

export function useDockBarOpenTab(deps: DockBarOpenTabDeps): OpenTabHandler {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  // 安装态门与「建 tab + 记住项目 agent」都复用既有路径（不自造会话创建 / 安装检查）。
  const { handleAgentClick } = useProjectAgents({
    agents: deps.agents,
    projectId: activeProjectId,
    showToast: notify,
    onAgentClick: deps.onAgentClick,
  });
  // 会话恢复的唯一链路（activate / bind / recreate+attach / resume 三级降级）。本 hook
  // 只负责「什么时候该用它」，判据与落地都在 live-sessions（不新造恢复路径）。
  const activateSession = useActivateSession();

  /** 新建该种类的 tab，返回 id；失败路径已就地提示（返回 null 即可）。 */
  const createTab = useCallback(
    (kind: OpenableTabKind, ctx: { projectId: ProjectId; tabKey: string }): string | null => {
      switch (kind) {
        case 'agent-chat':
          return openAgentChatTab(activeWorkspaceSession(ctx.projectId));
        case 'terminal':
          return openAgentTerminalTab(
            { tabKey: ctx.tabKey, agents: deps.agents },
            handleAgentClick,
          );
      }
    },
    [deps.agents, handleAgentClick],
  );

  return useCallback(
    (view: ViewKey, slot: DockSlot) => {
      const meta = DOCK_VIEW_META[view];
      const activation = meta?.activation;
      if (!meta || activation?.kind !== 'openTab') return;
      if (!isOpenableTabKind(activation.tabKind)) {
        notify(`Unknown tab kind: ${activation.tabKind}`, 'error');
        return;
      }

      const projectId = useProjectStore.getState().activeProjectId;
      const tabKey = projectId
        ? selectActiveWorkspaceKey(useWorkspaceStore.getState(), projectId)
        : null;
      if (!projectId || !tabKey) {
        notify('Open a project first', 'info');
        return;
      }

      // 落地槽 = 图标**当前**所在槽（图标在哪栏是布局事实，不是一条独立的 kind→slot 策略）
      const targetSlot = isDockSlot(slot) ? slot : meta.defaultSlot;

      const editorState = useEditorStore.getState();
      const layout = editorState.editorLayout[tabKey];
      const existing = findTabOfKind(editorState.tabs[tabKey], layout, activation.tabKind);
      if (existing) {
        // **再点一次 = 收起**（toggle 语义）：宿主正可见、且前台就是这条 tab → 收起该槽。
        // 注意收的是宿主（zone）而**不是** tab：种类入口背后是长跑会话（chat / PTY），
        // 用户点第二下的意图是「先藏起来」，不是「结束这个会话」。
        const dockState = useDockStore.getState();
        if (
          existing.dockSlot &&
          layout &&
          isViewVisible(dockState, tabHostView(existing.dockSlot)) &&
          layout.docked[existing.dockSlot].activeTabId === existing.tabId
        ) {
          dockState.toggleView(tabHostView(existing.dockSlot));
          return;
        }
        revealTab(tabKey, existing.tabId, existing.dockSlot);
        return;
      }

      // 新建**之前**：该单元还有用户真的用过的同类会话 → 走 live-sessions 的唯一恢复链
      // （接回存活 PTY / 续写已结束会话），不新建一条空会话。命中后语义与侧栏点会话行
      // 完全一致 —— 两边共用同一个 hook，不在这里重写「会话活没活」的判据。
      const latestSession = selectLatestSessionForUnit(
        useLiveSessionsStore.getState().sessions,
        tabKey,
        SESSION_KIND_OF_TAB_KIND[activation.tabKind],
      );
      if (latestSession) {
        activateSession(latestSession);
        // 恢复链可能**同步**建出一条 tab（chat 重建 / 接回存活终端）：它若落在收起的
        // 宿主里，这次点击就什么都看不见。复用「已有 tab」那条 reveal（激活 + 展开宿主）。
        // 异步恢复（终端续写要等一次 IPC）此刻还没有 tab，由 `DockTabHost` 的
        // 空 → 非空揭示接住 —— 两条路都不必在这里等 Promise。
        const after = useEditorStore.getState();
        const revived = findTabOfKind(
          after.tabs[tabKey],
          after.editorLayout[tabKey],
          activation.tabKind,
        );
        if (revived) revealTab(tabKey, revived.tabId, revived.dockSlot);
        return;
      }

      const tabId = createTab(activation.tabKind, { projectId, tabKey });
      if (!tabId) return; // 创建端口已提示
      // 新 tab 落到图标所在槽的宿主（D3：种类级策略，实例本身不持久化）
      if (!moveTabToSlot(tabKey, tabId, targetSlot)) {
        notify('Cannot open this tab in the dock', 'error');
      }
    },
    [activateSession, createTab],
  );
}

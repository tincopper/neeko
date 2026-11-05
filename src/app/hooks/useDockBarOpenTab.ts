import { useCallback } from 'react';

import { openAgentChatTab } from '@/features/agent-chat/api/openChatTab';
import { useActivateSession } from '@/features/live-sessions';
import {
  DOCK_VIEW_META,
  appViewKey,
  isDockSlot,
  slotVisibleView,
  tabHostView,
  type DockSlot,
  type ViewKey,
} from '@/shared/dock';
import { selectLatestSessionForUnit, sessionTab } from '@/shared/selectors/liveSessionSelectors';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { selectDockedActiveTab } from '@/shared/store/editorTabSelectors';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import { notify } from '@/shared/store/notificationStore';
import { useProjectStore } from '@/shared/store/projectStore';
import {
  activeWorkspaceSession,
  selectActiveWorkspaceKey,
  useWorkspaceStore,
} from '@/shared/store/workspaceStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import {
  SESSION_KIND_OF_TAB_KIND,
  findTabInSlot,
  findTabOfKind,
  isOpenableTabKind,
  matchOfOpenableKind,
  type OpenableTabKind,
  type TabKindTarget,
} from '../utils/tabKind';
import { moveTabToSlot } from '../utils/tabSurface';
import { createPlainTerminalTab } from '../utils/terminalTab';

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

/** 纯 shell 终端（与 tab 栏「+」同一个构造点）；配额满返回 null 并已提示。 */
function openPlainTerminalTab(tabKey: string, projectId: ProjectId): string | null {
  const tabId = createPlainTerminalTab(tabKey, projectId);
  if (!tabId) notify('Cannot open another terminal tab', 'error');
  return tabId;
}

export function useDockBarOpenTab(): OpenTabHandler {
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
          // Terminal 图标 = **纯 shell**，绝不默认拉起 agent（选了 agent 也不用）
          return openPlainTerminalTab(ctx.tabKey, ctx.projectId);
      }
    },
    [],
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
      // 收窄后存成局部常量：属性访问的收窄不进闭包（`findExisting` 里会退化成 string）
      const kind: OpenableTabKind = activation.tabKind;

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
      const tabs = editorState.tabs[tabKey];
      const match = matchOfOpenableKind(kind);
      // 入口作用域（声明表 `dockEntryScope`）：`slot` 只认**本栏**的实例 —— 中间那条
      // terminal 不该拦下右栏图标的点击（否则点击被解释成「激活中间那条」= 看起来无效）。
      const scope = meta.dockEntryScope ?? 'anywhere';
      const findExisting = (): TabKindTarget | null =>
        scope === 'slot'
          ? findTabInSlot(tabs, layout, targetSlot, kind, match)
          : findTabOfKind(tabs, layout, kind, match);

      const existing = findExisting();
      if (existing) {
        // **再点一次 = 收起**（toggle 语义）：宿主正可见、且前台就是这条 tab → 收起该槽。
        // 注意收的是宿主（zone）而**不是** tab：种类入口背后是长跑会话（chat / PTY），
        // 用户点第二下的意图是「先藏起来」，不是「结束这个会话」。
        //
        // 两个条件与图标选中态（`selectSlotFrontTabKind`）用的是**同一对派生点**：
        // `slotVisibleView`（本槽是否在显示该宿主）+ `selectDockedActiveTab`（该宿主前台是谁）。
        // 共用不是洁癖：两处一旦分叉，就会出现「图标亮着但点一下不收起」这种无解释行为。
        const dockState = useDockStore.getState();
        if (
          existing.dockSlot &&
          layout &&
          slotVisibleView(dockState, existing.dockSlot) === tabHostView(existing.dockSlot) &&
          selectDockedActiveTab(tabs, layout, existing.dockSlot)?.id === existing.tabId
        ) {
          dockState.toggleView(tabHostView(existing.dockSlot));
          return;
        }
        revealTab(tabKey, existing.tabId, existing.dockSlot);
        return;
      }

      // 新建**之前**：该单元还有用户真的用过的同类会话 → 走 live-sessions 的唯一恢复链
      // （接回存活 PTY / 续写已结束会话），不新建一条空会话。
      //
      // `slot` 作用域还要排除「已经被某条 tab 承载」的会话：恢复链对它们的处置是**激活那条
      // tab**（可能在别的 surface）—— 这次点击又会变成无效操作。正解是新建一条落到本栏。
      const allSessions = useLiveSessionsStore.getState().sessions;
      const kindSessions =
        kind === 'terminal'
          ? allSessions.filter((candidate) => candidate.agentId === null)
          : allSessions;
      const openTabs = tabs?.tabs ?? [];
      const candidateSessions =
        scope === 'slot'
          ? kindSessions.filter((candidate) => sessionTab(candidate, openTabs) === null)
          : kindSessions;
      const latestSession = selectLatestSessionForUnit(
        candidateSessions,
        tabKey,
        SESSION_KIND_OF_TAB_KIND[kind],
      );
      if (latestSession) {
        activateSession(latestSession);
        const after = useEditorStore.getState();
        const revived =
          scope === 'slot'
            ? findTabInSlot(
                after.tabs[tabKey],
                after.editorLayout[tabKey],
                targetSlot,
                activation.tabKind,
                match,
              )
            : findTabOfKind(
                after.tabs[tabKey],
                after.editorLayout[tabKey],
                activation.tabKind,
                match,
              );
        if (revived) revealTab(tabKey, revived.tabId, revived.dockSlot);
        else if (scope === 'slot') {
          // 恢复链建出的 tab 落在别的 surface（如 terminal 默认落中心）→ 搬到本栏：
          // 这个入口的语义就是「在这一栏打开」。
          const reclaimed = sessionTab(latestSession, after.tabs[tabKey]?.tabs ?? []);
          if (reclaimed) moveTabToSlot(tabKey, reclaimed.id, targetSlot);
        }
        // 异步恢复（终端续写要等一次 IPC）此刻还没有 tab —— 由 app 层的「内容到达即前置」
        // （`useDockTabHostReveal`）接住，两条路都不必在这里等 Promise。
        return;
      }

      const tabId = createTab(kind, { projectId, tabKey });
      if (!tabId) return; // 创建端口已提示
      // 新 tab 落到图标所在槽的宿主（D3：种类级策略，实例本身不持久化）
      if (!moveTabToSlot(tabKey, tabId, targetSlot)) {
        notify('Cannot open this tab in the dock', 'error');
      }
    },
    [activateSession, createTab],
  );
}

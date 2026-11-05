import { DOCK_SLOTS, type DockSlot } from '@/shared/dock';
import type { EditorSplitLayout, ProjectTabs, Tab } from '@/shared/types';
import type { SessionRef } from '@/shared/types/liveSessions';

/**
 * tab 空间的「视图投影」唯一读取面。
 *
 * **第一性原理**：`editorLayout[tabKey]` 是 tab 空间的唯一权威 —— 顺序（各组
 * `tabIds` 左 → 右 → `pinnedTabIds`）与前台（`activeGroupId` 指向组的 `activeTabId`）
 * 都在它里面。`tabs[tabKey]` 只是 `Tab` 的注册表（id → Tab 查询）。
 *
 * 因此「顺序」与「前台」不存储第二份，一律在此派生：
 * - `selectOrderedTabIds` / `selectOrderedTabs`：视觉顺序即仲裁顺序（左 → 右 → pinned → docked）；
 * - `selectActiveTabId`：前台 = 激活编辑器组的激活 tab（**不含** pinned 面板激活态，
 *   见下方说明）。
 *
 * 历史缺陷（2026-10-15）：`ProjectTabs.activeTabId` 与 `Tab.order` 曾各存第二份表示，
 * 分屏 / 拖拽重排后与 layout 分叉 —— 拖文件落到上一个 pane 的输入框、Cmd+W 关错 tab、
 * 仲裁按旧顺序取首个。根治 = 删除字段，让分叉在构造上不可表示。
 */
export interface EditorTabSpaceState {
  tabs: Record<string, ProjectTabs>;
  editorLayout: Record<string, EditorSplitLayout>;
}

/**
 * 顺序：left 组 → right 组 → pinned → docked.left → docked.right（视觉顺序即仲裁顺序）。
 *
 * 不变量 G2：本函数必须覆盖该空间的**全部** tab（长度相等、无重复）—— 新增 surface
 * 时忘记追加的表现是「停靠的 tab 不再参与仲裁 / 事件路由」，所以护栏测试直接
 * 用它和 `tabs[tabKey].tabs` 做集合比较。
 *
 * 不变量 I1（有 tab 的空间必有 layout，且各组 tabIds 恰好枚举该空间的 tab）成立时
 * 这就是全量；layout 缺失时返回 `[]`（优雅降级，生产中不可达 —— `addTab` 是唯一创建
 * 入口且总会 `ensureLayout`，tab 不持久化、无 session-restore 写入路径）。
 */
export function selectOrderedTabIds(state: EditorTabSpaceState, tabKey: string): string[] {
  const layout = state.editorLayout[tabKey];
  if (!layout) return [];
  return [
    ...layout.groups.left.tabIds,
    ...layout.groups.right.tabIds,
    ...layout.pinnedTabIds,
    ...layout.docked.left.tabIds,
    ...layout.docked.right.tabIds,
  ];
}

/**
 * 顺序投影成 `Tab`（跳过已失效 id —— 与 `useEditorGroupLayout` 的 heal 语义一致：
 * layout 可能残留已关闭 tab 的 id，消费端只渲染/仲裁仍存在的 tab）。
 */
export function selectOrderedTabs(state: EditorTabSpaceState, tabKey: string): Tab[] {
  const projectTabs = state.tabs[tabKey];
  if (!projectTabs) return [];
  const byId = new Map(projectTabs.tabs.map((tab) => [tab.id, tab]));
  const ordered: Tab[] = [];
  for (const id of selectOrderedTabIds(state, tabKey)) {
    const tab = byId.get(id);
    if (tab) ordered.push(tab);
  }
  return ordered;
}

/**
 * 前台 tab：`layout.groups[layout.activeGroupId].activeTabId`。
 *
 * **pinned 激活态（`pinnedActiveTabId`）与之正交、不在此派生**：pinned tab 不可关闭、
 * Cmd+W 从不命中它，它是「钉住的参照面板」而非当前工作 tab（今日行为，保持不变）。
 * layout 缺失 → `null`（优雅降级，见 `selectOrderedTabIds` 的 I1 说明）。
 */
export function selectActiveTabId(state: EditorTabSpaceState, tabKey: string): string | null {
  const layout = state.editorLayout[tabKey];
  if (!layout) return null;
  return layout.groups[layout.activeGroupId].activeTabId;
}

/** 该 tab 空间的存活 tab id 集合（注册表口径）；空间无注册表 → `null`（什么都渲染不出）。 */
function liveIdsOf(state: EditorTabSpaceState, tabKey: string): Set<string> | null {
  const liveTabs = state.tabs[tabKey]?.tabs;
  if (!liveTabs) return null;
  return new Set(liveTabs.map((tab) => tab.id));
}

/**
 * 一组 `tabIds` 里还有多少条**存活** id（布局给归属与顺序、注册表裁定存活）。
 *
 * 这是形态判据的唯一实现，`hasCenterTabs` / `countDockedTabs` 共用 —— 各写一份就会漂移：
 * 只数 `tabIds.length` 会把布局残留的幽灵 id 算成可渲染（空岛顶掉引导页 / 空宿主占位）。
 *
 * 返回**条数而不是布尔**：布尔只是 `> 0` 的投影，而「到达 = 条数增加」的揭示还需看见
 * 1 → 2 这种变化（布尔会把它抹平成「不变」）。「非空」只在消费侧（`isZoneRenderable`）
 * 与揭示（`counts[slot] > prev[slot]`）各决定一次，不在这里丢信息。
 */
function liveIdCount(liveIds: Set<string> | null, tabIds: readonly string[]): number {
  if (!liveIds || tabIds.length === 0) return 0;
  let count = 0;
  for (const id of tabIds) {
    if (liveIds.has(id)) count += 1;
  }
  return count;
}

/**
 * 中心画面是否有东西可渲染（`ProjectView` 在「编辑器 / 引导页」之间的唯一判据）。
 *
 * **为什么不是「注册表里有没有 tab」**：`tabs[tabKey]` 是整个 tab 空间的注册表，包含住在 dock
 * 槽位里的 tab。停靠（`docksNewTabs` / 右键 Move to Dock）只改变归属，**不改变中心区形态** ——
 * 那些 tab 由 dock 宿主（`DockTabHost`）自己渲染。用注册表总数当判据的表现是：点右栏 Terminal
 * 图标后新 tab 落 `docked.right`，中心区被判为「有 tab」→ 渲染一个中心组全空的
 * `EditorGroupLayout`（视觉空白岛），引导页被条件分支挤掉。
 *
 * 因此归属只由 `editorLayout` 的组表达：中心画面 = `groups.left` ∪ `groups.right` ∪
 * `pinnedTabIds`（pinned 面板与编辑器组同属中心区）。`docked.*` 刻意不参与。
 *
 * id 还必须仍在注册表里：布局会残留已移除 tab 的 id（见 `selectOrderedTabs` / `healEditorLayout`），
 * 而那些 id 渲染不出任何东西 —— 只数 `tabIds.length` 会把「幽灵 id」又算成可渲染，症状同样是空岛。
 * 「布局给顺序与归属、注册表裁定存活」与 `selectOrderedTabs` / `useDockedPane` 同一口径。
 *
 * 返回布尔原始值：这是给 zustand selector 直接消费的判据，返回数组/对象会让每次快照比较都判不等。
 * layout 缺失 → `false`（与 `selectOrderedTabIds` 同语义的优雅降级；此时 ProjectView 落到引导页 /
 * 欢迎页，正是期望）。
 */
export function hasCenterTabs(state: EditorTabSpaceState, tabKey: string): boolean {
  const layout = state.editorLayout[tabKey];
  if (!layout) return false;
  const liveIds = liveIdsOf(state, tabKey);
  const { left, right } = layout.groups;
  return (
    liveIdCount(liveIds, left.tabIds) +
      liveIdCount(liveIds, right.tabIds) +
      liveIdCount(liveIds, layout.pinnedTabIds) >
    0
  );
}

/**
 * 某槽的**槽位宿主**里可渲染 tab 的条数（zone 可见性与揭示的唯一内容事实，P5/P6）。
 *
 * 宿主是内容的投影，这个数同时驱动两件事：
 * - **可见性**：`isZoneRenderable` 在「前台是宿主」时做 `> 0` 判断 —— 空宿主不占位
 *   （不留一座空岛，也不用文案解释为什么是空的）；
 * - **揭示**：「到达 = 条数增加」（`useDockTabHostReveal` 的 `counts[slot] > prev[slot]`）。
 *   布尔在这里不够用：已折叠且已非空的槽再来一条（1 → 2）没有假 → 真跃迁，那次点击
 *   就会静默无反应。计数是该事实的**更细形式**，不是第二个判据。
 *
 * 存活口径与 `hasCenterTabs` 同一实现（`liveIdCount`）：布局可能残留已关闭 tab 的 id，
 * 那些 id 渲染不出任何 tab。`tabKey === null`（没有激活 workspace）→ `0`。
 */
export function countDockedTabs(
  state: EditorTabSpaceState,
  tabKey: string | null,
  slot: DockSlot,
): number {
  if (!tabKey) return 0;
  const layout = state.editorLayout[tabKey];
  if (!layout) return 0;
  return liveIdCount(liveIdsOf(state, tabKey), layout.docked[slot].tabIds);
}

/** `selectActiveTabId` 的 `Tab` 形态（前台 tab 对象；无前台 / 已失效 → `null`）。 */
export function selectActiveTab(state: EditorTabSpaceState, tabKey: string): Tab | null {
  const activeId = selectActiveTabId(state, tabKey);
  if (!activeId) return null;
  return state.tabs[tabKey]?.tabs.find((tab) => tab.id === activeId) ?? null;
}

/**
 * 某个**停靠宿主**的前台 tab（存活口径：注册表里没有该 id → `null`）。
 *
 * 与 `selectActiveTab` 分工：那个是中心组（`activeGroupId`），这个是某一个停靠槽。
 * **「这一槽的前台是谁」只有这一处派生**：要判断「这条 tab 是不是该宿主的前台」、
 * 「该宿主前台是哪个种类」、或要按「前台优先」选实例，一律调本函数 —— 在看板上自行比
 * `docked[slot].activeTabId` 会漏掉存活口径（布局可能残留已关闭 tab 的 id）。
 *
 * 收 `tabs` / `layout` 而不是 `(state, tabKey)`：本函数的调用方已把这两块结构解开
 * （app 层的纯函数衍生座与 `selectActiveSessionRefs` 都是这个粒度）。
 */
export function selectDockedActiveTab(
  tabs: ProjectTabs | undefined,
  layout: EditorSplitLayout | undefined,
  slot: DockSlot,
): Tab | null {
  const activeId = layout?.docked[slot].activeTabId;
  if (!activeId) return null;
  return (tabs?.tabs ?? []).find((tab) => tab.id === activeId) ?? null;
}

/**
 * 前台会话的完整身份（含所在单元），供 live-session 派生层过滤。
 *
 * 返回排序后的数组，调用方应在 `useMemo` 中按稳定的 `tabs` / `editorLayout`
 * 引用计算，而不是把它直接作为 zustand selector 的返回值（后者每次 getSnapshot
 * 都会生成新数组）。空集也无需共享常量：只有状态切片变化时才会重算。
 */
export function selectActiveSessionRefs(state: EditorTabSpaceState): readonly SessionRef[] {
  const refs: SessionRef[] = [];
  for (const tabKey of Object.keys(state.tabs)) {
    const tabs = state.tabs[tabKey];
    const layout = state.editorLayout[tabKey];
    // 中心前台 + 每个 dock 宿主的前台：两者都是「正在展示的会话」，父行高亮不得因为
    // 把 tab 停靠到侧区而熄灭（停靠不改「当前会话」这一事实）。
    const candidates: (Tab | null)[] = [selectActiveTab(state, tabKey)];
    for (const slot of DOCK_SLOTS) {
      candidates.push(selectDockedActiveTab(tabs, layout, slot));
    }
    for (const tab of candidates) {
      if (!tab) continue;
      const data = tab.data;
      if (data.kind === 'agent-chat' && data.sessionId) {
        refs.push({ workspaceKey: tabKey, kind: 'chat', sessionId: data.sessionId });
      } else if (data.kind === 'terminal' && data.ptySessionId) {
        refs.push({ workspaceKey: tabKey, kind: 'terminal', sessionId: data.ptySessionId });
      }
    }
  }
  return refs.sort((a, b) => a.workspaceKey.localeCompare(b.workspaceKey));
}

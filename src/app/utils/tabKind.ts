import {
  DOCK_SLOTS,
  isViewVisible,
  tabHostView,
  type DockLayoutState,
  type DockSlot,
} from '@/shared/dock';
import type { AppView } from '@/shared/store/appViewStore';
import type { EditorSplitLayout, ProjectTabs, Tab, TabKind } from '@/shared/types';
import type { SessionKind } from '@/shared/types/liveSessions';

/**
 * 「种类级入口」（`tabKind:*`）的两个读取面 —— 都是纯函数，不碰 store。
 *
 * 第一性原理：种类入口点下去只有两种结果（**激活已有的**或**新建一条**），而「已有」与
 * 「落在哪个槽」都是**布局事实的派生**，不是可以各写一份的判断：
 * - 哪条 tab 属于这个种类、它现在在哪个 surface → `findTabOfKind`（读 `editorLayout`）；
 * - 哪些种类此刻真的显示在屏幕上（图标选中态） → `selectVisibleTabKinds`（与 `DockTabHost`
 *   的可见判据同源：槽展开 + 宿主为前台）。
 *
 * 判据若散到消费侧，就会出现「图标高亮着但那条 tab 其实在收起的槽里」这类分叉。
 */

/**
 * 能由 dock 图标打开的 tab 种类 = **创建端口的注册表**。
 *
 * 新增一种可停靠 tab = 这里加一个 union 成员 + `useDockBarOpenTab` 里补一条创建分支
 * （switch 的穷尽性会在漏写时报错），声明表与 registry 各加一行。别处不需要改。
 */
export const OPENABLE_TAB_KINDS = ['agent-chat', 'terminal'] as const;
export type OpenableTabKind = (typeof OPENABLE_TAB_KINDS)[number];

/** 外部来源（`DockViewActivation.tabKind` 是 `string`）收窄成可打开种类。 */
export function isOpenableTabKind(value: string): value is OpenableTabKind {
  return (OPENABLE_TAB_KINDS as readonly string[]).includes(value);
}

/**
 * 可打开种类 → live-sessions 的会话种类（**唯一**映射）。
 *
 * 两者不是同一个联合：tab 种类是「界面上的一条 tab 长什么样」，会话种类是「后端注册表
 * 里一行是什么」。同名只是巧合（两边都会长出新成员），所以各自是独立联合 + 显式映射。
 * `satisfies Record<OpenableTabKind, SessionKind>` 让「新增可打开种类忘了配会话种类」
 * 在编译期报错，而不是运行期查不到会话（表现为静默新建一条空会话）。
 */
export const SESSION_KIND_OF_TAB_KIND = {
  'agent-chat': 'chat',
  terminal: 'terminal',
} satisfies Record<OpenableTabKind, SessionKind>;

/**
 * 种类入口认哪条**实例**：`terminal` 只认**纯 shell**（`agentId === null`）。
 *
 * Terminal 图标不是「打开 Agent」的入口 —— 项目选了 agent 之后，若按种类匹配到一条
 * agent 终端并把它激活，用户点 Terminal 却得到一个 agent 会话，语义就串了。
 * chat 不做区分（每条 chat tab 都是用户显式开的会话）。
 */
export function matchOfOpenableKind(kind: OpenableTabKind): (tab: Tab) => boolean {
  return kind === 'terminal'
    ? (tab) => tab.data.kind === 'terminal' && tab.data.agentId == null
    : () => true;
}

/**
 * 只在**指定槽**里找该种类的 tab（`dockEntryScope: 'slot'` 用）。
 *
 * 与 `findTabOfKind` 的差别是范围而不是判据：判据（`match`）必须两边一致，否则
 * 「什么算同一条」会出现第二个定义。
 */
export function findTabInSlot(
  tabs: ProjectTabs | undefined,
  layout: EditorSplitLayout | undefined,
  slot: DockSlot,
  kind: TabKind,
  match: (tab: Tab) => boolean = () => true,
): TabKindTarget | null {
  const group = layout?.docked[slot];
  if (!group) return null;
  const byId = new Map((tabs?.tabs ?? []).map((tab) => [tab.id, tab]));
  for (const id of group.tabIds) {
    const tab = byId.get(id);
    if (tab && tab.data.kind === kind && match(tab)) return { tabId: tab.id, dockSlot: slot };
  }
  return null;
}

/** 目标 tab 与它所在的 surface：`dockSlot` 非空 = 停靠宿主，`null` = 中心区（含 pinned）。 */
export interface TabKindTarget {
  tabId: string;
  dockSlot: DockSlot | null;
}

/**
 * 找当前 tab 空间里该种类的 tab（**点击是「回到我正在用的那条」**）。
 *
 * 优先级：前台（中心或任一槽位宿主的前台）→ 否则注册顺序首条。后者只在两条同种 tab
 * 都不在前台时出现（分屏 / 停靠各一条），此时任选一条都只能是启发式 —— 但必须是
 * **确定性**的启发式，否则同样输入点两次会跳到不同的 tab。
 */
export function findTabOfKind(
  tabs: ProjectTabs | undefined,
  layout: EditorSplitLayout | undefined,
  kind: TabKind,
  /** 种类内的进一步筛选（如 `terminal` 只认纯 shell —— Terminal 图标不是 Agent 入口）。 */
  match: (tab: Tab) => boolean = () => true,
): TabKindTarget | null {
  const matches = (tabs?.tabs ?? []).filter((tab) => tab.data.kind === kind && match(tab));
  if (matches.length === 0) return null;
  if (!layout) return { tabId: matches[0].id, dockSlot: null };

  const foreground = new Set<string>();
  foreground.add(layout.groups[layout.activeGroupId].activeTabId ?? '');
  for (const slot of DOCK_SLOTS) foreground.add(layout.docked[slot].activeTabId ?? '');
  const target = matches.find((tab) => foreground.has(tab.id)) ?? matches[0];

  const dockSlot =
    DOCK_SLOTS.find((slot) => layout.docked[slot].tabIds.includes(target.id)) ?? null;
  return { tabId: target.id, dockSlot };
}

/**
 * 当前**真的显示出来**的 tab 种类集合（图标选中态的唯一判据）。
 *
 * 用 `string` 而不是 `TabKind` 作元素类型：入参来源是声明表的 `tabKind`（遮蔽成
 * `TabKindLike`，刻意不让 `shared/dock` 依赖 tab 联合），消费侧只做「这个种类亮不亮」，
 * 收窄成联合只会在边界多一次断言。
 *
 * 中心区只在 `normal` 视图下可见（Library / Settings 覆盖它，此时中间的 tab 看不见）；
 * 槽位宿主与 `DockTabHost` 同判据（槽展开 + 宿主为前台）。
 */
export function selectVisibleTabKinds(
  tabs: ProjectTabs | undefined,
  layout: EditorSplitLayout | undefined,
  dock: Pick<DockLayoutState, 'zones'>,
  appView: AppView,
): ReadonlySet<string> {
  const kinds = new Set<string>();
  if (!layout) return kinds;

  const byId = new Map((tabs?.tabs ?? []).map((tab) => [tab.id, tab]));
  const add = (tabId: string | null | undefined): void => {
    const tab = tabId ? byId.get(tabId) : undefined;
    if (tab) kinds.add(tab.data.kind);
  };

  if (appView === 'normal') add(layout.groups[layout.activeGroupId].activeTabId);
  for (const slot of DOCK_SLOTS) {
    if (isViewVisible(dock, tabHostView(slot))) add(layout.docked[slot].activeTabId);
  }
  return kinds;
}

/**
 * Dock 布局的纯类型面 —— 不依赖 React / store / 声明表 / registry。
 *
 * 「谁在哪个槽位」只有**一份**表示：`DockLayoutState.placements`。
 * 工具栏（bar）与 zone 都是它的派生投影。曾经的 `zones[].panels` + `barItems[]`
 * 让同一次「图标换边」必须双写，漏一处就得到「图标在右、面板还开在左」——
 * 这类缺陷在构造上不该存在。
 */

/** 槽位标识。新增槽位（如 bottom）只在这里扩展，派生逻辑一律遍历 `DOCK_SLOTS`。 */
export type DockSlot = 'left' | 'right';

export const DOCK_SLOTS: readonly DockSlot[] = ['left', 'right'];

export function isDockSlot(value: unknown): value is DockSlot {
  return value === 'left' || value === 'right';
}

/**
 * 不透明视图标识。唯一 mint 点在 `viewKey.ts`（与 `WorkspaceSession#key` 同构）。
 *
 * 结构类型仍是 `string`，所以「传了声明表里不存在的视图」不会编译报错 ——
 * 真伪一律由 `DOCK_VIEW_META` 查表裁决（不在表里 → 丢弃 / 忽略）。
 */
export type ViewKey = string & { readonly __brand: 'ViewKey' };

/** 遮蔽具体 TabKind 联合：`shared/dock` 不依赖 `shared/types/tab` 的成员变化。 */
export type TabKindLike = string;

/** 视图在 zone 里的呈现方式。`none` = 只上 bar（中心视图入口 / 种类级入口）。 */
export type DockViewHost = 'singleton' | 'tabHost' | 'none';

/**
 * 点击图标做什么。行为从「靠一个字段推断」变成「显式分支」——
 * 新增行为只加 union 成员（OCP），不需要在消费侧猜 `openAs === 'tab'` 的含义。
 *
 * `appView.view` 故意是 `string`：`shared/dock` 不依赖 `shared/store/appViewStore`
 * 的联合类型，合法性由消费点的 `isAppView` 守卫裁定（非法值 = 忽略，不是崩溃）。
 */
export type DockViewActivation =
  | { kind: 'toggleZone' }
  | { kind: 'openTab'; tabKind: TabKindLike }
  | { kind: 'appView'; view: string };

export interface DockViewMeta {
  view: ViewKey;
  host: DockViewHost;
  activation: DockViewActivation;
  defaultSlot: DockSlot;
  /** 仅用于建表排序，入库时归一化为该槽内的 0..n-1。 */
  defaultOrder: number;
  /** 默认是否在工具栏上给出图标（缺省 = true）。 */
  defaultOnBar?: boolean;
  /** 默认 true；`tabHost` 这类固定在自己槽的视图置 false（能力校验在 store action 层）。 */
  movable?: boolean;
  /** 该视图激活时的默认槽宽百分比。 */
  defaultSlotSize?: number;
  /**
   * 该种类**新建的 tab** 是否默认停靠到宿主槽（缺省 `false` = 落中心区）。
   *
   * 显式能力位而不是从 `activation.kind` 推断：种类入口（`openTab`）与「新 tab 的落点」
   * 是两个互相独立的事实 —— 两者恰好都要给 `agent-chat` 开，而 `terminal` 只要前者
   * （普通 shell / 任务终端不该被搬进侧区）。推断写法的失败形态是「加了一个入口就顺带
   * 改变了所有该种类 tab 的落点」，且改不动其中之一。
   *
   * 消费点只有一个：`app/dock/registerNewTabDockPolicy`（经 `editorStore.addTab` 问
   * `shared/store/tabSurfacePolicy`）。
   */
  docksNewTabs?: boolean;
}

export interface DockPlacement {
  view: ViewKey;
  slot: DockSlot;
  /** 槽内相对顺序，恒为 0..n-1（不是跨槽的全局序）。 */
  order: number;
  /** 是否在工具栏上给出图标（「钉住」）。 */
  onBar: boolean;
}

export interface DockZoneRuntime {
  expanded: boolean;
  /** 该槽的前台视图；必须始终属于该槽或为 null（`applyMove` 就地修复，禁止消费侧兜底）。 */
  activeView: ViewKey | null;
}

/** 布局状态（`placements` + `zones` 是 dockStore 的核心切片）。 */
export interface DockLayoutState {
  placements: Readonly<Record<string, DockPlacement>>;
  zones: Readonly<Record<DockSlot, DockZoneRuntime>>;
}

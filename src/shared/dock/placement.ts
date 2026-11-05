import { DOCK_SLOTS, isDockSlot } from './types';
import type { DockLayoutState, DockPlacement, DockSlot, DockZoneRuntime, ViewKey } from './types';

/**
 * 落位（placement）的纯 reducer 与读取面。
 *
 * 本模块**刻意不依赖** `DOCK_VIEW_META`：能力校验（movable / host）属于 store 的 action 层。
 * 这里只管「把某个已知视图搬到某个已知槽的某个下标」，并保证搬完之后布局自身仍然自洽
 * —— 尤其是 `activeView` 永不悬挂（悬挂不会报错，只会让前台悄悄回落到槽内别的视图：用户
 * 看到的面板与他刚拖动的图标对不上）。
 */

function comparePlacements(a: DockPlacement, b: DockPlacement): number {
  if (a.order !== b.order) return a.order - b.order;
  // ties 用 view 兜底：坏快照可能出现重复 order，读侧仍必须是确定性的
  return a.view.localeCompare(b.view);
}

/**
 * 槽内落位（有序）。
 *
 * 单参形态（只给 placements）供迁移 / 清洗使用 —— 那时 `zones` 还没造出来；
 * 组件与 store 一律走 `slotPlacements(state, slot)`。
 */
export function placementsInSlot(
  placements: Readonly<Record<string, DockPlacement>>,
  slot: DockSlot,
): DockPlacement[] {
  return Object.values(placements)
    .filter((p) => p.slot === slot)
    .sort(comparePlacements);
}

export function slotPlacements(state: DockLayoutState, slot: DockSlot): DockPlacement[] {
  return placementsInSlot(state.placements, slot);
}

export function slotViews(state: DockLayoutState, slot: DockSlot): ViewKey[] {
  return slotPlacements(state, slot).map((p) => p.view);
}

export function hasSlotViews(state: DockLayoutState, slot: DockSlot): boolean {
  return slotPlacements(state, slot).length > 0;
}

/**
 * 该槽**当前可见**的前台视图（`null` = 槽收起 / 无前台）。
 *
 * **槽范围的问题一律问它**（「这一栏在显示谁」）：收起的槽即使 `activeView` 还指着某个视图
 * 也不算可见。跨槽问题才用 `isViewVisible`（「它是否出现在屏幕上的某处」），后者就是本函数的
 * `some`。两个口径分开是一次回归的产物：曾经用跨槽判据回答槽内问题 —— 当另一个槽的前台指向
 * 本槽的视图（宿主换槽 / 快照异常）时，明明收起的本栏会因为那个槽而“可见”。
 */
export function slotVisibleView(
  state: Pick<DockLayoutState, 'zones'>,
  slot: DockSlot,
): ViewKey | null {
  const zone = state.zones[slot];
  return zone?.expanded === true ? zone.activeView : null;
}

/**
 * 视图是否在某个槽里**可见**（前台 + 展开）。面板按需加载的门控口径。
 * 消费侧不要自己遍历 `zones` 比较 activeView —— 两份判据必然漂移。
 *
 * 入参只收 `zones`（结构子集）：可见性**只**依赖槽运行态。收窄后，只需要可见性的派生不必
 * 为此造一份假的 `placements`。
 *
 * **这是跨槽判据**（任一槽可见即为真）。问「**这一栏**在显示谁」用 `slotVisibleView` —— 用本函数
 * 回答槽内问题会转移到「视图只在自己的槽里」这类外部不变量上，那种依赖不会报错，只会待机出错。
 */
export function isViewVisible(state: Pick<DockLayoutState, 'zones'>, view: ViewKey): boolean {
  return DOCK_SLOTS.some((slot) => slotVisibleView(state, slot) === view);
}

export interface MoveViewRequest {
  view: ViewKey;
  to: DockSlot;
  /** 目标槽内的插入下标；缺省 = 追加到末尾。非有限数同样按追加处理。 */
  index?: number;
}

function sameOrder(a: readonly ViewKey[], b: readonly ViewKey[]): boolean {
  return a.length === b.length && a.every((view, index) => view === b[index]);
}

function clampIndex(requested: number | undefined, length: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return length;
  return Math.min(Math.max(Math.trunc(requested), 0), length);
}

/**
 * 移动视图，并在**同一个返回值**里修复两个槽的 `activeView`。
 *
 * 为什么修复必须在这里：`activeView` 悬挂是**静默**的 —— `zoneFrontView` 只会回落到槽内
 * 首个可渲染视图，用户看到的面板就与他刚拖动的图标分叉（「图标在右、面板却是别的」）。
 * 一半修一半不修的状态在构造上不该存在，所以调用方永远不需要（也不允许）自己兜底。
 */
export function applyMove(state: DockLayoutState, req: MoveViewRequest): DockLayoutState {
  const placement = state.placements[req.view];
  // 1. 未知视图 / 非法槽位 → 静默返回原引用（坏输入不能把布局变成空白，也不能抛）
  if (!placement || !isDockSlot(req.to)) return state;

  const from = placement.slot;
  const to = req.to;
  const sourceList = slotViews(state, from);
  const targetList = from === to ? sourceList : slotViews(state, to);

  // 3. 插入点在被拖项移除后的下标空间里 clamp（NaN / Infinity → 追加）
  const rest = targetList.filter((view) => view !== req.view);
  const insertAt = clampIndex(req.index, rest.length);
  const nextTarget = [...rest.slice(0, insertAt), req.view, ...rest.slice(insertAt)];

  // 2 / 7. 同槽且顺序未变 → 原引用（幂等：同样的请求再跑一次必然落到这里）
  if (from === to && sameOrder(sourceList, nextTarget)) return state;

  const nextSource = from === to ? nextTarget : sourceList.filter((view) => view !== req.view);

  const placements: Record<string, DockPlacement> = { ...state.placements };
  nextTarget.forEach((view, order) => {
    placements[view] = { ...placements[view], slot: to, order };
  });
  if (from !== to) {
    // 源槽 order 归一化：删掉中间一项后必须补齐 0..n-1，否则「槽内序号」不再是可比较的序
    nextSource.forEach((view, order) => {
      placements[view] = { ...placements[view], slot: from, order };
    });
  }

  // 5. 同槽重排只重算该槽，前台与展开态一律不动
  if (from === to) return { placements, zones: state.zones };

  // 4 / 6. 目标槽展开并置前台（D2：移动意图 = 想看到它）；源槽前台就地改指邻位，空槽则 null
  const sourceZone = state.zones[from];
  const remaining = nextSource;
  let sourceActive: ViewKey | null = sourceZone?.activeView ?? null;
  if (sourceActive === req.view || (sourceActive !== null && !remaining.includes(sourceActive))) {
    const removedAt = sourceList.indexOf(req.view);
    sourceActive = remaining[removedAt] ?? remaining[removedAt - 1] ?? remaining[0] ?? null;
  }

  const zones: Record<DockSlot, DockZoneRuntime> = { ...state.zones };
  zones[to] = { expanded: true, activeView: req.view };
  // D5：源槽展开态不动（拖走一个图标不该连带关掉别的面板）
  zones[from] = { expanded: sourceZone?.expanded ?? false, activeView: sourceActive };

  return { placements, zones };
}

/** 切前台并展开（`toggleZone` 族视图的「激活」语义）。 */
export function applyActivate(state: DockLayoutState, view: ViewKey): DockLayoutState {
  const placement = state.placements[view];
  if (!placement) return state;

  const zone = state.zones[placement.slot];
  if (zone?.activeView === view && zone.expanded) return state;

  return {
    placements: state.placements,
    zones: { ...state.zones, [placement.slot]: { expanded: true, activeView: view } },
  };
}

/**
 * toggle 框架契约（`dockStore.toggleView` 的纯部分）：
 * **toggle-off 仅当该视图当前可见时**成立，其余一律按激活处理。
 */
export function applyToggle(state: DockLayoutState, view: ViewKey): DockLayoutState {
  const placement = state.placements[view];
  if (!placement) return state;

  const zone = state.zones[placement.slot];
  if (zone?.activeView === view && zone.expanded) {
    return {
      placements: state.placements,
      zones: { ...state.zones, [placement.slot]: { ...zone, expanded: false } },
    };
  }
  return applyActivate(state, view);
}

/** 钉住 / 取消钉住工具栏图标（只改 `onBar`，不影响槽位与前台）。 */
export function applyOnBar(state: DockLayoutState, view: ViewKey, onBar: boolean): DockLayoutState {
  const placement = state.placements[view];
  if (!placement || placement.onBar === onBar) return state;

  return {
    placements: { ...state.placements, [view]: { ...placement, onBar } },
    zones: state.zones,
  };
}

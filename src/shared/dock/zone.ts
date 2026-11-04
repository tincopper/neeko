import { DOCK_VIEW_META } from './panelMeta';
import { placementsInSlot } from './placement';
import type { DockLayoutState, DockSlot, ViewKey } from './types';

/**
 * Zone 的**内容派生**面：前台是谁、以及「这个槽有没有东西可渲染」。
 *
 * 第一性原理（P5）：容器可见性是内容的函数 —— 容器不能比内容活得久。于是 zone 的占位
 * 判据是「展开 ∧ 前台视图有内容可渲染」：
 *
 * - 无状态面板（projects / files / gitControl / …）内容随时可重建 ⇒ 恒为「有内容」；
 * - 槽位宿主（`host: 'tabHost'`）的内容是**按 workspace 投影**的 tab 集合 ⇒ 由调用方
 *   注入 `hostTabCount`（该槽宿主里可渲染 tab 的**条数**；`shared/dock` 不认识 tab 域，
 *   与 `tabSurfacePolicy` 同一手法）。"非空"只在本文件的 `> 0` 处决定一次 —— 消费侧
 *   （`DockLayout` / `AppShell`）不再做布尔映射，因为同一份事实还要驱动「到达 = 条数增加」
 *   的揭示（布尔会把 1 → 2 抹平成「不变」）。
 *
 * 为什么独立于 `placement.ts`：那个模块**刻意不依赖声明表**（能力校验在 store action
 * 层），而「有没有 zone 内容」正是声明表的事实（`host`）。混在一起会把两个层次的
 * 知识绑死。
 *
 * `host: 'none'` 的视图（Library / 种类级入口）有落位（图标占某一栏）但没有 zone 内容 ——
 * `sanitize` 不过滤它们，所以 `activeView` 可能指向它们；前台派生必须在这里兜底回落，
 * **不得**在 DockZone / DockLayout 各写一份（两份兜底必然漂移）。
 */

/**
 * 该槽里会渲染进 zone 的视图（声明表口径，顺序 = 槽内 order）。
 *
 * 这是「哪些视图属于 zone」的**唯一**过滤器：`DockZone` 的渲染列表与前台派生共用它，
 * 不要在消费侧再用「registry 里有没有 component」过滤一遍 —— 那会把同一判据复制成两份
 * （`buildDockPanelRegistry` 已保证 hosted 视图必有 component）。
 */
export function zoneHostedViews(state: DockLayoutState, slot: DockSlot): ViewKey[] {
  return placementsInSlot(state.placements, slot)
    .map((placement) => placement.view)
    .filter((view) => {
      const meta = DOCK_VIEW_META[view];
      return meta !== undefined && meta.host !== 'none';
    });
}

/**
 * 「该槽前台是谁」的唯一派生点。
 *
 * 返回值是**布局事实**（与展开态无关：收起的槽仍记得前台，重新展开时回到同一处）。
 * `activeView` 悬挂（不在槽内）或指向 `host: 'none'` 的视图时回落到槽内首个可渲染视图 ——
 * 悬挂本身由 `applyMove` / `sanitize` 就地修好，这里的回落只处理「落位合法但没有 zone
 * 内容」这一类，且只此一份。
 *
 * 槽内没有可渲染视图 → `null`（调用方据此不占位）。
 */
export function zoneFrontView(state: DockLayoutState, slot: DockSlot): ViewKey | null {
  const views = zoneHostedViews(state, slot);
  if (views.length === 0) return null;
  const activeView = state.zones[slot]?.activeView ?? null;
  return activeView !== null && views.includes(activeView) ? activeView : views[0];
}

/**
 * 该槽是否应当占位：**展开 ∧ 前台视图有内容可渲染**。
 *
 * `hostTabCount` = 本槽的槽位宿主里可渲染 tab 的**条数**（app 层注入；左右槽各一个，
 * 因为宿主固定在自己的槽 —— `movable: false` 由 `sanitize` 强制）。「非空」（`> 0`）只在此
 * 处决定：调用方不传布尔、也不自己判 `> 0` —— 同一个计数既驱动可见性，又驱动揭示的
 * 「条数增加」，两份事实同源才不会漂移。
 *
 * 左右**同一规则**：`isZoneRenderable(state, 'left', …)` 与 `'right'` 没有特判分支 ——
 * 左栏之所以通常恒可见，是因为它的前台通常是 `projects`（无状态），不是因为它是左侧。
 */
export function isZoneRenderable(
  state: DockLayoutState,
  slot: DockSlot,
  hostTabCount: number,
): boolean {
  if (state.zones[slot]?.expanded !== true) return false;
  const front = zoneFrontView(state, slot);
  if (front === null) return false;
  // `zoneFrontView` 只返回「声明表里 hosted」的视图（同一模块、同一个过滤器），所以这里
  // 不需要第二处「meta 不存在」兜底。**穷尽 switch 而不是三元**：新增 host variant 时必须
  // 在这里被迫作决定（`tsc` 报「not all code paths return a value」），不得静默落某个默认值。
  const { host } = DOCK_VIEW_META[front];
  switch (host) {
    case 'tabHost':
      return hostTabCount > 0;
    case 'singleton':
      return true;
    case 'none':
      // 不可达：`zoneFrontView` 已把 `host: 'none'` 过滤掉（`zoneHostedViews`）。
      // 仍显式给出答案，让这个分支在类型层面自洽（而不是靠「fallthrough 返回 undefined」）。
      return false;
  }
}

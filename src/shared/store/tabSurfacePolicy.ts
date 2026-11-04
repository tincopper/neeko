import type { DockSlot } from '@/shared/dock/types';
import type { Tab } from '@/shared/types/tab';

/**
 * 「新建的 tab 落在哪个 surface」的**唯一**策略点（单槽注册表）。
 *
 * 为什么需要它：tab 的归属只有一处表示（`editorLayout` 的组），但「新建时该放进哪个
 * 组」是**种类级策略**（`DOCK_VIEW_META[*].docksNewTabs`），而 `editorStore` 不允许
 * 认识 dock 域（`editorStore ⇏ dockStore / panelMeta`，见 design §5 的依赖方向护栏）。
 * 于是把策略反过来注册进来：store 只问「这条新 tab 该放哪个槽」，谁回答、按什么回答
 * 都不在 store 的知识范围内。
 *
 * **单槽而不是数组**：归属只允许一条策略。两个策略同时存在必然打架（同一条 tab 被
 * 指派到两个槽），而「后注册的覆盖先注册的」是这里唯一可表达的确定语义 —— 数组则
 * 会把冲突留给消费侧去裁决。
 *
 * 实现手法照 `registerTabCleanup`（`editorStore` 里的既有扩展点）：模块级注册表 +
 * 注册 / 注销函数，避免 feature ↔ store 的静态依赖。缺省（未注册）= 中心区，与引入
 * 本模块之前的行为逐字一致。
 */
export type TabSurfacePolicy = (tab: Tab) => DockSlot | null;

let policy: TabSurfacePolicy | null = null;

/** 注册（覆盖）策略；传同一个函数是幂等的（启动期 `bootstrap()` 只跑一次，但不惩罚重复）。 */
export function registerTabSurfacePolicy(next: TabSurfacePolicy): void {
  policy = next;
}

/** 注销策略：之后新建的 tab 一律回中心区（测试与热重载的清理入口）。 */
export function unregisterTabSurfacePolicy(): void {
  policy = null;
}

/**
 * 问一次策略：返回槽位 = 这条新 tab 直接进该槽的宿主组，`null` = 中心区。
 *
 * 只在调用方**没有**显式指定落组时被调用（显式落组 = 用户意图，优先级高于种类策略）。
 */
export function resolveTabSurface(tab: Tab): DockSlot | null {
  return policy ? policy(tab) : null;
}

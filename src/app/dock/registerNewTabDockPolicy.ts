import { DOCK_VIEW_META, tabKindView } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import { registerTabSurfacePolicy } from '@/shared/store/tabSurfacePolicy';
import type { Tab } from '@/shared/types/tab';

/**
 * 新 tab 落点的**唯一实现**：种类声明表的 `docksNewTabs`（能力位）→ 图标当前所在槽。
 *
 * 为什么在 app 层：它同时需要「声明表」（shared）与「落位」（dockStore）。store 自己
 * 不认识 dock 域（`editorStore ⇏ dockStore`），所以由启动期把策略注册进
 * `shared/store/tabSurfacePolicy`，`addTab` 只在缺省落组时问一次。
 *
 * 槽位取 `placements[view].slot`（**图标当前所在的槽**）而不是 `meta.defaultSlot`：
 * 落位是布局事实，`defaultSlot` 只是首次启动的声明默认值 —— 用后者会造出第二条
 * 「kind → slot」策略，用户把图标拖到左栏后新 tab 仍会落到右侧。
 *
 * 图标是否显示在工具栏（`onBar`）不参与判断：它只决定图标可不可见，不改变「这个视图
 * 住在哪个槽」。
 */
export function registerNewTabDockPolicy(): void {
  registerTabSurfacePolicy((tab: Tab) => {
    const view = tabKindView(tab.data.kind);
    if (DOCK_VIEW_META[view]?.docksNewTabs !== true) return null;
    // 声明表里有、落位里没有（sanitize 会保证两者一致）→ 回落中心区而不是猜一个槽
    return useDockStore.getState().placements[view]?.slot ?? null;
  });
}

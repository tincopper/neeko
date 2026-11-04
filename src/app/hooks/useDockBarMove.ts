import { useCallback } from 'react';

import { DOCK_VIEW_META, isDockSlot, type DockSlot, type ViewKey } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import { notify } from '@/shared/store/notificationStore';

/**
 * 「把图标移到某个槽」的唯一 app 层入口（拖拽与 Alt+←/→ 共用）。
 *
 * 能力校验（`movable` / 非法槽位）的权威在 `dockStore.moveView`；本 hook 只把拒绝
 * 翻译成用户能懂的提示。校验写两处必然漂移 —— UI 放行、store 拒绝的表现是
 * 「拖了没反应，也没有解释」。
 *
 * 提示走 `notify`（store 侧）而不是 `useAppContext`：本 hook 由组合根在 Provider
 * **之外**装配（`App.tsx` 的 header 计算先于 `<AppProviders>` 渲染），Context 在那里不存在。
 */
export function useDockBarMove(): (view: ViewKey, slot: DockSlot, index?: number) => void {
  return useCallback((view: ViewKey, slot: DockSlot, index?: number) => {
    if (!isDockSlot(slot)) return;
    if (useDockStore.getState().moveView(view, slot, index)) return;
    if (DOCK_VIEW_META[view]?.movable === false) {
      notify('This view is pinned to its side', 'info');
    }
  }, []);
}

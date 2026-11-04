import { useCallback, useMemo } from 'react';

import { DOCK_VIEW_META, isDockSlot, type DockSlot, type ViewKey } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import { notify } from '@/shared/store/notificationStore';

import { setPendingFocus } from './dockBarFocusHandoff';

/** 拖拽路径的端口（`DockLayout.onMoveView`）：只落位，**不碰焦点**。 */
export type MoveViewPort = (view: ViewKey, slot: DockSlot, index?: number) => void;

/** 键盘路径的端口（`DockBarButton.onMove`）：落位成功后把焦点交接给换边后的图标。 */
export type MoveViewByKeyboardPort = (view: ViewKey, slot: DockSlot) => void;

export interface DockBarMovePorts {
  moveView: MoveViewPort;
  moveViewByKeyboard: MoveViewByKeyboardPort;
}

/**
 * 「把图标移到某个槽」的唯一 app 层入口（拖拽与 Alt+←/→ 共用同一份落位实现）。
 *
 * 能力校验（`movable` / 非法槽位）的权威在 `dockStore.moveView`；本 hook 只把拒绝
 * 翻译成用户能懂的提示。校验写两处必然漂移 —— UI 放行、store 拒绝的表现是
 * 「拖了没反应，也没有解释」。
 *
 * 两个端口唯一的差异是**焦点交接**：键盘换边后按钮在另一条栏重新挂载（原 DOM 被卸载），
 * 焦点必须跟着走，否则键盘用户失去位置；鼠标拖拽不抢焦点。判断放在这里而不是按钮里，
 * 因为「这次移动是谁发起的」只有调用方知道。
 *
 * 提示走 `notify`（store 侧）而不是 `useAppContext`：本 hook 由组合根在 Provider
 * **之外**装配（`App.tsx` 的 header 计算先于 `<AppProviders>` 渲染），Context 在那里不存在。
 */
export function useDockBarMove(): DockBarMovePorts {
  const apply = useCallback((view: ViewKey, slot: DockSlot, index?: number): boolean => {
    if (!isDockSlot(slot)) return false;
    if (useDockStore.getState().moveView(view, slot, index)) return true;
    if (DOCK_VIEW_META[view]?.movable === false) {
      notify('This view is pinned to its side', 'info');
    }
    return false;
  }, []);

  const moveView = useCallback<MoveViewPort>(
    (view, slot, index) => {
      apply(view, slot, index);
    },
    [apply],
  );

  const moveViewByKeyboard = useCallback<MoveViewByKeyboardPort>(
    (view, slot) => {
      // 拒绝 / 幂等 no-op 时不登记：没有可跟随的目标，登记只会把焦点塞到无关图标上
      if (!apply(view, slot)) return;
      setPendingFocus(view);
    },
    [apply],
  );

  return useMemo(() => ({ moveView, moveViewByKeyboard }), [moveView, moveViewByKeyboard]);
}

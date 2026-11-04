/**
 * 键盘换边后的焦点交接（模块级、单次消费）。
 *
 * 用 `Alt+←/→` 换边时，图标会在**另一条栏**重新挂载 —— 原 `<button>` 连同焦点一起被
 * 卸载，浏览器把焦点丢到 `body`，键盘用户立刻失去位置（下一次按方向键已经不知道该从
 * 哪儿开始）。
 *
 * 手法与 `useFileDrop` 的 `pendingDrag` 同构：写入方（键盘落位**成功后**）记下视图身份，
 * 目标按钮挂载时消费并清零 —— 交接是单次的，重复挂载不会再把焦点抢回来。
 *
 * **只有键盘路径写入**：鼠标拖拽结束时抢焦点会把用户的当前位置塞到别处（且拖拽本身
 * 已经给了「图标跟手 + 落点高亮」的反馈）。见 `useDockBarMove` 的两个端口。
 */

import type { ViewKey } from '@/shared/dock';

let pendingView: ViewKey | null = null;

/** 键盘换边成功：登记「焦点应跟随到这个图标」。 */
export function setPendingFocus(view: ViewKey): void {
  pendingView = view;
}

/** 目标按钮挂载时调用：命中则消费（清零）并返回 true。 */
export function consumePendingFocus(view: ViewKey): boolean {
  if (pendingView !== view) return false;
  pendingView = null;
  return true;
}

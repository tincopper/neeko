/**
 * quickfix 弹出菜单的定位计算（**纯函数**，两个渲染方共用）。
 *
 * 为什么单独抽出来：菜单有两处宿主 —— Problems 面板的行内菜单（React + portal）与
 * 编辑器内菜单（CM6 扩展，非 React）。定位规则（下方放不下就翻上方、水平夹紧、
 * 给 max-height 内部滚动）必须只有一份实现，否则两边会各自漂移。
 */

/** 菜单与锚点之间的间距。 */
export const MENU_GAP = 4;
/** 菜单与视口边缘的最小留白。 */
export const VIEWPORT_MARGIN = 8;
/** 菜单最小可用高度（再压缩就不如不给）。 */
export const MIN_MENU_HEIGHT = 80;

export interface RectLike {
  top: number;
  bottom: number;
  left: number;
}

export interface SizeLike {
  width: number;
  height: number;
}

export interface ViewportLike {
  width: number;
  height: number;
}

export interface MenuPosition {
  top: number;
  left: number;
  maxHeight: number;
  /** 是否向上展开（供调用方决定要不要加动画/圆角方向）。 */
  openUpward: boolean;
}

/**
 * 计算 fixed 定位菜单的 `top` / `left` / `maxHeight`。
 *
 * - 竖直：下方空间不足且上方更宽裕 → 翻到上方；否则贴下方
 * - 水平：夹紧在视口内（靠右时左移，靠左时右移）
 * - `maxHeight`：取展开侧可用空间，长列表在菜单内部滚动而不是溢出屏幕
 */
export function computeMenuPosition(
  anchor: RectLike,
  menu: SizeLike,
  viewport: ViewportLike,
): MenuPosition {
  const spaceBelow = viewport.height - anchor.bottom - VIEWPORT_MARGIN;
  const spaceAbove = anchor.top - VIEWPORT_MARGIN;
  const openUpward = spaceBelow < menu.height + MENU_GAP && spaceAbove > spaceBelow;

  const top = openUpward
    ? Math.max(VIEWPORT_MARGIN, anchor.top - MENU_GAP - menu.height)
    : anchor.bottom + MENU_GAP;

  const maxLeft = Math.max(VIEWPORT_MARGIN, viewport.width - menu.width - VIEWPORT_MARGIN);
  const left = Math.min(Math.max(VIEWPORT_MARGIN, anchor.left), maxLeft);

  const maxHeight = Math.max(MIN_MENU_HEIGHT, (openUpward ? spaceAbove : spaceBelow) - MENU_GAP);

  return { top, left, maxHeight, openUpward };
}

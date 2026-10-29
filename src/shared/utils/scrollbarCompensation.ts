/**
 * 滚动条占位补偿（唯一来源）。
 *
 * ## 第一性原理
 *
 * `reset.css` 的全局 `scrollbar-width: thin` 让滚动条静止时透明不可见，但它仍是
 * **经典滚动条**：占布局宽度、且只占**右侧**。于是同一个容器天然是
 * 「左 padding ↔ 右 padding + 滚动条」—— 右边凭空宽一条，内容看着没铺满。
 *
 * 占位的**归属是单个元素**：只有真正溢出的容器才有滚动条。因此补偿量必须逐元素实测
 * （`offsetWidth - clientWidth`），不能用一次全局测得的常量 —— 后者会在「内容不足
 * 一屏、没有滚动条」的容器上把留白补反（右窄左宽），把 bug 换个方向复现。
 *
 * ## 两种模式（都让左右视觉留白相等，差别只在动哪一侧）
 *
 * - `widen`：右内边减掉占位 —— 内容变宽、左边界不动。给**有右内边**的容器用
 *   （markdown 预览 / 图片 / agent-chat）。
 * - `center`：左内边加上占位 —— 容器右内边为 0 时减法无处可减（PDF 滚动区 / 会话列表），
 *   改补左侧，内容居中于整个盒子。
 *
 * 基线内边始终由 Tailwind 类表达（`px-6` / `p-4`）：本模块只写**调整量**，每次先清掉
 * 自己写的 inline 值再读基线，因此幂等（重复调用不会越减越多），也不把数值搬进 JS。
 */

export type ScrollbarCompensationMode = 'widen' | 'center';

/** 调用方可显式声明「不补偿」（如 VirtualList 的既有消费方）。 */
export type ScrollbarCompensation = ScrollbarCompensationMode | 'none';

/** 测量滚动条所需的最小形状。 */
interface ScrollbarOwnerLike {
  offsetWidth: number;
  clientWidth: number;
}

/** 滚动条占位宽度（px）；无滚动条 / overlay 滚动条为 0。 */
export function scrollbarWidthOf(el: ScrollbarOwnerLike): number {
  return Math.max(0, el.offsetWidth - el.clientWidth);
}

/**
 * 内容盒宽度（= 内容真正可用的宽度）。
 *
 * `clientWidth` 含 padding，也含左侧补偿；需要「排版可用宽度」的地方（PDF fit-width）
 * 必须扣掉两侧内边，否则会溢出。
 */
export function contentBoxWidthOf(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const padding = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  return Math.max(0, el.clientWidth - padding);
}

/** 补偿作用的内边属性。 */
function paddingPropOf(mode: ScrollbarCompensationMode): 'padding-right' | 'padding-left' {
  return mode === 'widen' ? 'padding-right' : 'padding-left';
}

/**
 * 应用一次补偿，返回实测占位宽度。
 *
 * 幂等：先清掉自己写的 inline 值，从 class 基线重新算。
 */
export function applyScrollbarCompensation(
  el: HTMLElement,
  mode: ScrollbarCompensationMode,
): number {
  const prop = paddingPropOf(mode);
  el.style.removeProperty(prop);
  // 清掉 inline 后读到的才是 class 基线（computed style 按需重算）
  const base = parseFloat(getComputedStyle(el).getPropertyValue(prop)) || 0;
  const gutter = scrollbarWidthOf(el);
  const next = mode === 'widen' ? Math.max(0, base - gutter) : base + gutter;
  if (next !== base) el.style.setProperty(prop, `${next}px`);
  return gutter;
}

/**
 * 应用补偿并跟随变化（挂载/尺寸变化/溢出状态变化）。
 *
 * ResizeObserver 观察 content-box：滚动条出现会让内容盒宽度减少一个占位 ⇒ 触发回调，
 * 因此「内容从不足一屏变成可滚动」也会被自动纠正。
 *
 * @returns 停止观察并移除 inline 调整（卸载清理用）
 */
export function observeScrollbarCompensation(
  el: HTMLElement,
  mode: ScrollbarCompensationMode,
): () => void {
  const apply = () => {
    applyScrollbarCompensation(el, mode);
  };
  apply();
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
  observer?.observe(el);
  return () => {
    observer?.disconnect();
    el.style.removeProperty(paddingPropOf(mode));
  };
}

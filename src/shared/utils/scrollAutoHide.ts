/**
 * 滚动条自动隐藏 —— 两种机制，同一语义（滚动时可见，停止滚动 delayMs 后隐藏）：
 *
 * 1. **原生滚动条**（绝大多数容器）：`initScrollAutoHide()` 用 document 级 capture
 *    委托监听 scroll（scroll 不冒泡，只有 capture 能收到所有容器，且天然覆盖动态创建
 *    的容器），给滚动元素挂 `.is-scrolling`，配合 `reset.css` 的 `scrollbar-color` 切换。
 * 2. **xterm 自绘滚动条**：它不读 `scrollbar-color`，显隐由 xterm 内部
 *    VisibilityController 掌管，且只在指针移出滚动区时才隐藏 —— 终端的滚动区就是整个
 *    面板，指针停在里面时永远可见。故由 `createScrollIdleTag()` 订阅 `term.onScroll`，
 *    停止滚动后给壳层挂 `.scroll-idle`（配合 `components/xterm.css` 淡出）。
 *
 * 两个类名极性相反（`.is-scrolling` = 正在滚动 / `.scroll-idle` = 已停下），因为后者
 * 必须「无类 = 可见」才失败安全：接线缺失时退回 xterm 原行为，而不是让滚动条消失。
 */

const SCROLLING_CLASS = 'is-scrolling';
export const DEFAULT_HIDE_DELAY_MS = 3000;

/**
 * 初始化全局滚动条自动隐藏。应用启动时调用一次。
 * @returns dispose 移除监听（HMR / 卸载清理用）
 */
export function initScrollAutoHide(delayMs: number = DEFAULT_HIDE_DELAY_MS): () => void {
  const timers = new Map<Element, ReturnType<typeof setTimeout>>();

  const handleScroll = (event: Event) => {
    const target = event.target;
    // window/document 滚动（target 非 Element）不处理，应用内滚动都发生在元素上
    if (!(target instanceof Element)) return;
    const pending = timers.get(target);
    if (pending) clearTimeout(pending);
    target.classList.add(SCROLLING_CLASS);
    timers.set(
      target,
      setTimeout(() => {
        target.classList.remove(SCROLLING_CLASS);
        timers.delete(target);
      }, delayMs),
    );
  };

  document.addEventListener('scroll', handleScroll, { capture: true, passive: true });
  return () => {
    document.removeEventListener('scroll', handleScroll, { capture: true });
    timers.forEach((timer, target) => {
      clearTimeout(timer);
      target.classList.remove(SCROLLING_CLASS);
    });
    timers.clear();
  };
}

/**
 * 停止滚动后给元素挂的类：`.scroll-idle`（配合 `components/xterm.css` 让 xterm
 * 自绘滚动条的滑块淡出）。
 *
 * **极性与 `.is-scrolling` 相反（无类 = 可见）** 是有意为之的失败安全：xterm 的
 * 滚动条显隐由它内部的 VisibilityController 掌管，只在指针**移出滚动区**时才隐藏
 * （`_mouseIsOver` 守卫）—— 而终端的滚动区就是整个面板，指针停在里面时滚动条永远
 * 可见。接线缺失时"无类=可见"会退回 xterm 原行为，而不是让滚动条彻底消失。
 */
export const SCROLL_IDLE_CLASS = 'scroll-idle';

/** 滚动空闲标记器（每个宿主各自持有一个，按元素记时）。 */
export interface ScrollIdleTag {
  /** 记录一次滚动：清掉 idle 类，并在 delayMs 内无新滚动时挂上。 */
  reveal(el: Element | null): void;
  /** 清计时器 + 移除残留类（卸载时调用）。 */
  dispose(): void;
}

/** 创建滚动空闲标记器（终端面板用；原生滚动条走上面的全局委托）。 */
export function createScrollIdleTag(delayMs: number = DEFAULT_HIDE_DELAY_MS): ScrollIdleTag {
  const timers = new Map<Element, ReturnType<typeof setTimeout>>();

  return {
    reveal(el) {
      if (!el) return;
      const pending = timers.get(el);
      if (pending) clearTimeout(pending);
      el.classList.remove(SCROLL_IDLE_CLASS);
      timers.set(
        el,
        setTimeout(() => {
          el.classList.add(SCROLL_IDLE_CLASS);
          timers.delete(el);
        }, delayMs),
      );
    },
    dispose() {
      timers.forEach((timer, el) => {
        clearTimeout(timer);
        el.classList.remove(SCROLL_IDLE_CLASS);
      });
      timers.clear();
    },
  };
}

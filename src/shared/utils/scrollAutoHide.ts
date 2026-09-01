/**
 * 全局滚动条自动隐藏：滚动容器滚动时加 `.is-scrolling` 类，
 * 最后一次滚动 3s 后移除（配合 base.css 的 ::-webkit-scrollbar 规则）。
 *
 * 采用 document 级 capture 委托监听——scroll 事件不冒泡，
 * 只有 capture 能在 document 上收到所有容器的滚动，且天然覆盖动态创建的容器。
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

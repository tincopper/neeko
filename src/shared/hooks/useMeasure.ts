import { useCallback, useLayoutEffect, useState } from 'react';

export interface UseMeasureResult {
  /** 挂载到待测量容器上的 callback ref（晚挂载时自动触发重测） */
  containerRef: (el: HTMLElement | null) => void;
  /** 当前被测量的容器元素（未挂载为 null） */
  node: HTMLElement | null;
  /** 容器当前高度（未挂载为 0） */
  height: number;
}

/**
 * 测量容器高度：容器晚挂载、尺寸变化时自动重新测量。
 *
 * - callback ref + state node：首帧骨架/空态不渲染容器时，容器出现后
 *   ref 回调触发 setNode → effect 重跑，避免「视口高度恒为 0 → 虚拟列表
 *   只渲染 overscan 行，下方空白需滚动才补全」。
 * - ResizeObserver 监听尺寸变化，卸载时自动断开。
 */
export function useMeasure(): UseMeasureResult {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(0);

  const containerRef = useCallback((el: HTMLElement | null) => {
    setNode(el);
    // 容器卸载时归零（ref 回调时机与卸载语义一致，避免 effect 内同步 setState）
    if (!el) {
      setHeight(0);
    }
  }, []);

  useLayoutEffect(() => {
    if (!node) return;
    const measure = () => setHeight(node.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);

  return { containerRef, node, height };
}

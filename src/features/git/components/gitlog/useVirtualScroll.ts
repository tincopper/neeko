import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useMeasure } from '@/shared/hooks';

import { computeRowOffsets, getVirtualWindow } from './virtualScroll';

export interface UseVirtualScrollOptions {
  rowCount: number;
  /** -1 = 无展开行 */
  selectedRowIndex: number;
  /** 展开面板额外高度（来自 useExpandPanel） */
  expandHeight: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

/**
 * 虚拟滚动：滚动位置跟踪、视口测量、虚拟窗口计算与无限滚动。
 *
 * 跨 hook 耦合点：expandHeight（useExpandPanel）→ rowOffsets → 窗口。
 */
export function useVirtualScroll({
  rowCount,
  selectedRowIndex,
  expandHeight,
  hasMore,
  loadingMore,
  onLoadMore,
}: UseVirtualScrollOptions) {
  const [scrollTop, setScrollTop] = useState(0);
  // 视口测量复用 useMeasure：晚挂载/尺寸变化自动重测（callback ref + RO）
  const { containerRef, node, height: viewportHeight } = useMeasure();
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 无限滚动：sentinel 进入视口触发加载更多
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  const handleScroll = useCallback(() => {
    if (!node) return;
    setScrollTop(node.scrollTop);
  }, [node]);

  const rowOffsets = useMemo(
    () => computeRowOffsets(rowCount, selectedRowIndex, expandHeight),
    [rowCount, selectedRowIndex, expandHeight],
  );

  const { startIndex, endIndex, offsetY } = useMemo(
    () => getVirtualWindow(rowOffsets, scrollTop, viewportHeight),
    [rowOffsets, scrollTop, viewportHeight],
  );

  // 总高度 sentinel（scroll 容器高度 / 无限滚动哨兵定位）
  const totalHeight = rowOffsets[rowCount] ?? 0;

  return { containerRef, sentinelRef, handleScroll, startIndex, endIndex, offsetY, totalHeight };
}

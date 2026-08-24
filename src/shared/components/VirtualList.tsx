import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useCallback, useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

export interface VirtualListHandle {
  scrollToIndex: (index: number, align?: 'center' | 'start' | 'end') => void;
  getScrollElement: () => HTMLDivElement | null;
}

interface VirtualListProps<T> {
  items: T[];
  getKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Fixed estimate for unmeasured rows (px). */
  estimateSize?: number;
  overscan?: number;
  /** Scroll container className — must establish a bounded height (flex/px). */
  className?: string;
  /** Inline styles for the scroll container (e.g. explicit height in tests). */
  listStyle?: React.CSSProperties;
  /** Fallback container rect before measurement (jsdom tests). */
  initialRect?: { width: number; height: number };
  /** Called with the currently rendered index range [start, end). */
  onRangeChange?: (start: number, end: number) => void;
  onScroll?: (scrollTop: number) => void;
  /** Imperative handle exposed to parent for programmatic scrolling. */
  handleRef?: React.MutableRefObject<VirtualListHandle | null>;
}

function VirtualListInner<T>({
  items,
  getKey,
  renderItem,
  estimateSize = 96,
  overscan = 8,
  className,
  listStyle,
  initialRect,
  onRangeChange,
  onScroll,
  handleRef,
}: VirtualListProps<T>): React.ReactElement {
  const internalScrollRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => internalScrollRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (index) => getKey(items[index], index),
    ...(initialRect ? { initialRect } : {}),
  });

  const onRangeChangeRef = useRef(onRangeChange);
  onRangeChangeRef.current = onRangeChange;

  const lastRangeRef = useRef<[number, number]>([-1, -1]);
  React.useEffect(() => {
    const v = virtualizer.getVirtualItems();
    if (v.length === 0) {
      lastRangeRef.current = [-1, -1];
      return;
    }
    const start = v[0].index;
    const end = v[v.length - 1].index + 1;
    const [prevStart, prevEnd] = lastRangeRef.current;
    if (start !== prevStart || end !== prevEnd) {
      lastRangeRef.current = [start, end];
      onRangeChangeRef.current?.(start, end);
    }
  });

  if (handleRef) {
    handleRef.current = {
      scrollToIndex: (index: number, align: 'center' | 'start' | 'end' = 'center') => {
        virtualizer.scrollToIndex(index, { align });
      },
      getScrollElement: () => internalScrollRef.current,
    };
  }

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      onScroll?.(e.currentTarget.scrollTop);
    },
    [onScroll],
  );

  // 动态高度测量：渲染后触发 virtualizer 重新测量，修正 translateY 位置
  const measureRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) {
        virtualizer.measureElement(el);
      }
    },
    [virtualizer],
  );

  // 每次 virtualizer 尺寸变化后强制重新渲染（解决动态高度不更新问题）
  const [, setVersion] = React.useState(0);
  useEffect(() => {
    // @tanstack/react-virtual v3 没有 subscribe，依赖 measureElement 触发重渲染
    setVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时执行一次
  }, []);

  return (
    <div
      ref={internalScrollRef}
      onScroll={handleScroll}
      data-testid="scroll-list"
      className={cn('overflow-y-auto', className)}
      style={listStyle}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((vi) => (
          <div
            key={vi.key}
            ref={measureRef}
            data-index={vi.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${vi.start}px)`,
            }}
          >
            {renderItem(items[vi.index], vi.index)}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Generic windowed list virtualizer built on @tanstack/react-virtual.
 * Only visible rows (plus overscan) are mounted; the scroll container must
 * have a bounded height via `className`.
 */
export function VirtualList<T>(props: VirtualListProps<T>): React.ReactElement {
  return <VirtualListInner {...props} />;
}
VirtualList.displayName = 'VirtualList';

import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useCallback, useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';
import { useScrollbarCompensation } from '@/shared/hooks/useScrollbarCompensation';
import { useScrollMemory } from '@/shared/hooks/useScrollMemory';
import type { ScrollbarCompensation } from '@/shared/utils/scrollbarCompensation';

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
  /**
   * 滚动条占位补偿模式（滚动元素归本组件所有，因此由本组件落地）：
   * `widen` 减右内边 / `center` 补左内边 / `none` 不补偿（默认，既有消费方行为不变）。
   * 机制见 `shared/utils/scrollbarCompensation.ts`。
   */
  scrollbarCompensation?: ScrollbarCompensation;
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
  scrollbarCompensation = 'none',
}: VirtualListProps<T>): React.ReactElement {
  const internalScrollRef = useRef<HTMLDivElement | null>(null);
  useScrollbarCompensation(internalScrollRef, scrollbarCompensation);
  // 容器可见性：隐藏（display:none 期间）停用 virtualizer——
  // 让 tanstack 主动 cleanup 行元素的 ResizeObserver，防止行在脱离渲染树时被测成
  // 0 尺寸后永久污染 itemSizeCache（导致恢复显示时前面的行不可见/塌缩）。
  const [scrollVisible, setScrollVisible] = React.useState(true);
  // 滚动位置修复（display:none 期间引擎丢 scrollTop 的写回）与其余面板同源：
  // 共享 `useScrollMemory` 承载镜像 / 隐藏快照 / 帧内复核（复核晚于下方 tanstack 的
  // enabled 恢复写入，避免写回被 initialOffset=0 覆盖）。
  // key=null：本组件暂不做跨卸载持久化（消费点各有显式滚动意图——文件树定位、
  // 会话加载/贴底——待逐点决策后再接线）。
  const scrollMemoryRef = useScrollMemory<HTMLDivElement>(null);
  // 合并回调 ref：VirtualListHandle.getScrollElement 仍需要 mutable ref。
  const setScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      internalScrollRef.current = node;
      scrollMemoryRef(node);
    },
    [scrollMemoryRef],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => internalScrollRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (index) => getKey(items[index], index),
    enabled: scrollVisible,
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

  // ① 可见性门控：enabled=false 让 tanstack 在隐藏期间 cleanup 行 RO 并卸载行元素，
  //    杜绝 itemSizeCache 被 0 尺寸污染（measurements 完整保留，恢复后正常）。
  // ② 滚动位置的写回不在这里：由 `useScrollMemory` 负责 —— tanstack 恢复 enabled 时
  //    会写一次 initialOffset=0（layout effect 阶段），共享 hook 的帧内复核在其后
  //    落位，期间忽略 scroll 事件以免镜像被污染；virtualizer 的内部 offset 随写回
  //    触发的 scroll 事件对齐。超界由共享 hook clamp。
  useEffect(() => {
    const el = internalScrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setScrollVisible(el.offsetHeight !== 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
      ref={setScrollRef}
      onScroll={handleScroll}
      data-testid="scroll-list"
      className={cn('overflow-y-auto', className)}
      data-scrollbar-compensation={
        scrollbarCompensation === 'none' ? undefined : scrollbarCompensation
      }
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

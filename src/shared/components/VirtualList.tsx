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
  // 容器可见性：隐藏（display:none 期间）停用 virtualizer——
  // 让 tanstack 主动 cleanup 行元素的 ResizeObserver，防止行在脱离渲染树时被测成
  // 0 尺寸后永久污染 itemSizeCache（导致恢复显示时前面的行不可见/塌缩）。
  const [scrollVisible, setScrollVisible] = React.useState(true);
  // 最后一次真实 scrollTop 镜像。display:none 期间（无 scroll 事件）保持最后已知值，
  // 恢复显示时与 DOM scrollTop 比对，差异时把 DOM 写回镜像值（浏览器丢滚动位置时
  // —— 已知 WKWebView 行为——保留用户位置；正常引擎下滚动位置已被保留时是 no-op）。
  const lastScrollTopRef = useRef(0);
  // 隐藏瞬间的恢复目标快照。恢复 enabled 时 tanstack 会向 DOM 写一次
  // initialOffset(0)，其触发的 scroll 事件会把镜像一起污染为 0 ——
  // 恢复写回必须用这份快照，恢复完成后清空。
  const pendingRestoreRef = useRef<number | null>(null);

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
      lastScrollTopRef.current = e.currentTarget.scrollTop;
      onScroll?.(e.currentTarget.scrollTop);
    },
    [onScroll],
  );

  // display:none → 显示恢复的双重修复：
  // ① enabled=false 让 tanstack 在隐藏期间 cleanup 行 RO 并卸载行元素，
  //    杜绝 itemSizeCache 被 0 尺寸污染（measurements 完整保留，恢复后正常）。
  //    注意：tanstack 恢复 enabled 时会按 getScrollOffset()（disabled 期间被
  //    清成 initialOffset=0）向 DOM 写一次滚动位置 —— 见下方 ② 的时序。
  // ② 恢复显示时若真实 scrollTop 与镜像脱节则写回镜像（WKWebView display:none
  //    期间丢弃滚动位置；正常引擎下 tanstack 的恢复写入也会把它拉回 0）。
  //    写回必须在 passive effect 里做：tanstack 的恢复写入发生在 layout effect
  //    阶段且此时它还没重挂 scroll 监听，若在 RO 回调（渲染前）同步写回会被
  //    tanstack 的恢复写入覆盖。effect 在其后执行 → 我们后写、最终生效，且
  //    scroll 事件随之把 virtualizer 内部 offset 对齐。超界浏览器 clamp。
  useEffect(() => {
    const el = internalScrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (el.offsetHeight === 0) {
        // 隐藏瞬间快照恢复目标（此后 tanstack/引擎的恢复写入会污染镜像与 DOM）
        pendingRestoreRef.current = lastScrollTopRef.current;
        setScrollVisible(false);
        return;
      }
      setScrollVisible(true);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!scrollVisible) return;
    const el = internalScrollRef.current;
    if (!el) return;
    const target = pendingRestoreRef.current;
    pendingRestoreRef.current = null;
    if (target == null) return;
    if (Math.abs(el.scrollTop - target) < 1) return;
    el.scrollTo({ top: target });
  }, [scrollVisible]);

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

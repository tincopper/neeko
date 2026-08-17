import { useCallback, useEffect, useRef, type RefObject } from 'react';

import { browserSetBounds } from '../api/browserApi';

interface UseBrowserBoundsSyncOptions {
  /** webview label；null 时禁用（无 webview）。 */
  label: string | null;
  containerRef: RefObject<HTMLDivElement | null>;
  /** 仅当 webview 已创建时同步（懒创建/未创建跳过）。 */
  isCreatedRef: RefObject<boolean>;
}

interface BrowserBoundsSync {
  /** 立即同步 bounds 到 OS webview（创建后/手动定位时调用）。 */
  updateBounds: (rect: DOMRect) => Promise<void>;
  /** 下一帧重采样后同步（mount 恢复/窗口聚焦等布局未稳定场景）。 */
  syncBoundsNextFrame: () => void;
}

/**
 * 容器 → OS 级悬浮 webview 的 bounds 同步（ResizeObserver + window resize + focus，
 * 差异 < 2px 去抖）。由 browser panel 与 editor browser tab 共用，避免两处重复实现。
 */
export function useBrowserBoundsSync({
  label,
  containerRef,
  isCreatedRef,
}: UseBrowserBoundsSyncOptions): BrowserBoundsSync {
  const lastSyncedRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const DIFF_THRESHOLD_PX = 2;

  const updateBounds = useCallback(
    async (rect: DOMRect) => {
      if (!label || !isCreatedRef.current) return;
      try {
        await browserSetBounds(label, rect.x, rect.y, rect.width, rect.height);
      } catch (err) {
        console.error('[Browser] Failed to update bounds:', err);
      }
    },
    [label, isCreatedRef],
  );

  // 下一帧同步 bounds：布局未稳定(mount 恢复/窗口重新聚焦)时
  // getBoundingClientRect() 可能返回旧值或 0，延迟到 rAF 后再采样，
  // 避免 webview 错位/顶部被遮挡。
  const syncBoundsNextFrame = useCallback(() => {
    if (!containerRef.current || !isCreatedRef.current) return;
    requestAnimationFrame(() => {
      if (!containerRef.current || !isCreatedRef.current) return;
      updateBounds(containerRef.current.getBoundingClientRect());
    });
  }, [updateBounds, containerRef, isCreatedRef]);

  // 容器尺寸变化 → 同步 bounds（替代定时轮询）：ResizeObserver 在 layout 真正
  // 变化时精准触发。差异 < 2px 时跳过，避免微小抖动导致重复 set。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !label) return;
    const syncIfNeeded = () => {
      if (!isCreatedRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const last = lastSyncedRectRef.current;
      if (
        last &&
        Math.abs(last.x - rect.x) < DIFF_THRESHOLD_PX &&
        Math.abs(last.y - rect.y) < DIFF_THRESHOLD_PX &&
        Math.abs(last.w - rect.width) < DIFF_THRESHOLD_PX &&
        Math.abs(last.h - rect.height) < DIFF_THRESHOLD_PX
      ) {
        return;
      }
      lastSyncedRectRef.current = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
      void updateBounds(rect);
    };
    const observer = new ResizeObserver(syncIfNeeded);
    observer.observe(el);
    const handleResize = () => requestAnimationFrame(syncIfNeeded);
    window.addEventListener('resize', handleResize);
    const handleFocus = () => requestAnimationFrame(syncIfNeeded);
    window.addEventListener('focus', handleFocus);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('focus', handleFocus);
    };
  }, [label, containerRef, updateBounds, isCreatedRef]);

  return { updateBounds, syncBoundsNextFrame };
}

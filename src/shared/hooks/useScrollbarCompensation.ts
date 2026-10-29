import { useLayoutEffect, type RefObject } from 'react';

import {
  observeScrollbarCompensation,
  type ScrollbarCompensation,
} from '@/shared/utils/scrollbarCompensation';

/**
 * 内容滚动容器：实测自身滚动条占位并补偿内边（机制与两种模式见
 * `shared/utils/scrollbarCompensation.ts`）。
 *
 * 用 `useLayoutEffect` 而非 `useEffect`：补偿必须在首次绘制前落到 DOM，否则内容会在
 * 首帧后横向跳一个滚动条宽度。
 *
 * @param mode `widen` 减右内边（内容变宽）/ `center` 补左内边（内容居中）/ `none` 关闭
 */
export function useScrollbarCompensation(
  ref: RefObject<HTMLElement | null>,
  mode: ScrollbarCompensation = 'widen',
): void {
  useLayoutEffect(() => {
    if (mode === 'none') return;
    const el = ref.current;
    if (!el) return;
    return observeScrollbarCompensation(el, mode);
  }, [ref, mode]);
}

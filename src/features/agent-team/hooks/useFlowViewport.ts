import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { isPanClick, zoomFromWheel } from '../utils/flowViewport';

/**
 * 分配图画布的**视口**（wheel zoom + pointer pan）。
 *
 * # 为什么单独成 hook
 *
 * `TeamFlowGraph` 同时承担布局数学、SVG 结构与交互；把视口那 ~90 行留在组件里会把它
 * 顶到组件规模红线（≤300 行）的边沿。抽出来之后组件只负责「把 hook 返回的 ref 与事件
 * 挂到容器上」，交互逻辑可单独读、可单独测。
 *
 * # 单一 zoom 持有者（红线 17 同族）
 *
 * - `zoom` 有值 = **受控**：中央 tab 的 +/- 按钮与 wheel 都回写 `onZoomChange`，
 *   组件内部那份 state 恒为 1 且从不被读写。
 * - `zoom` 省略 = **非受控**（dock）：组件内部自管一份 `innerZoom`。
 *
 * 绝不两边各存一份再同步 —— 那会让「谁是当前缩放」有两个答案。
 *
 * # wheel 必须原生非 passive
 *
 * React 合成的 `onWheel` 是 passive listener，`preventDefault()` 会被忽略并打控制台
 * 警告，页面跟着滚。这里用 `addEventListener('wheel', h, { passive: false })`，
 * cleanup 移除**同一个** handler 引用。
 *
 * # pan 不是 dnd-kit 的场景
 *
 * 画布 pan 只改滚动视口，不改变任何元素顺序、没有落点判定 —— dnd-kit 是列表排序用的
 * （见 `.trellis/spec/frontend/interaction-patterns.md`）。拖动超阈值时吞掉随后的
 * click，避免拖完手一松误开任务详情；零位移的正常点击必须仍然可点。
 */
interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  /** 累计位移是否超过阈值：超过则 pointerup 后的 click 要被吞掉。 */
  moved: boolean;
}

export interface FlowViewport {
  /** 挂到滚动容器（有界高度才有垂直 pan 空间）。 */
  viewportRef: React.RefObject<HTMLDivElement>;
  /** 当前生效缩放：受控取 prop，非受控取内部 state。 */
  effectiveZoom: number;
  /** 是否用精确像素尺寸渲染 SVG（受控，或非受控但已滚轮缩放）。 */
  precise: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  /** 捕获阶段：拖过就不让 click 继续冒泡到任务节点。 */
  onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => void;
}

export function useFlowViewport(options: {
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
}): FlowViewport {
  const { zoom, onZoomChange } = options;
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const prevViewportRef = useRef<{ zoom: number; w: number; h: number } | null>(null);
  // 非受控模式的唯一持有者；受控时它恒为 1 且从不被读、从不被写。
  const [innerZoom, setInnerZoom] = useState(1);
  const controlled = zoom !== undefined;
  const effectiveZoom = zoom !== undefined ? zoom : innerZoom;
  // 受控恒用精确像素；dock 静止时保持响应式（100%），滚轮改过 zoom 才转精确像素。
  const precise = controlled || effectiveZoom !== 1;

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const next = zoomFromWheel(effectiveZoom, event.deltaY);
      if (controlled) onZoomChange?.(next);
      else setInnerZoom(next);
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [effectiveZoom, controlled, onZoomChange]);

  // 缩放后按前后内容尺寸比例把容器中心下的内容留在原处（不做指针锚点矩阵，YAGNI）。
  // jsdom 无布局（scrollWidth=0）时整段跳过；真实 WebView 里才生效。
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const prev = prevViewportRef.current;
    const w = el.scrollWidth;
    const h = el.scrollHeight;
    if (prev && prev.zoom !== effectiveZoom && prev.w > 0 && prev.h > 0 && w > 0 && h > 0) {
      const cx = el.clientWidth / 2;
      const cy = el.clientHeight / 2;
      el.scrollLeft = (el.scrollLeft + cx) * (w / prev.w) - cx;
      el.scrollTop = (el.scrollTop + cy) * (h / prev.h) - cy;
    }
    prevViewportRef.current = { zoom: effectiveZoom, w, h };
  }, [effectiveZoom]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // 主键 + 主指针才起拖（多指的第二个触点不该抢走 pan）。jsdom 合成事件不带
    // pointerType / isPrimary，真实鼠标恒 isPrimary=true，故用 pointerType 区分。
    const pointerType: string = event.pointerType;
    if (event.button !== 0 || (pointerType !== '' && !event.isPrimary)) return;
    const el = event.currentTarget;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
    suppressClickRef.current = false;
    // 指针移出容器仍继续拖；jsdom 未实现该 API，生产 WebView 有。
    if (typeof el.setPointerCapture === 'function') el.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (isPanClick(event.clientX - drag.startX, event.clientY - drag.startY)) drag.moved = true;
    const el = viewportRef.current;
    if (el) {
      el.scrollLeft -= dx;
      el.scrollTop -= dy;
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    // pointerup 紧接着才是 click：把「这次要不要吞」留给捕获阶段判断。
    suppressClickRef.current = drag.moved;
    const el = event.currentTarget;
    if (typeof el.releasePointerCapture === 'function') {
      el.releasePointerCapture(event.pointerId);
    }
  };

  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.stopPropagation();
    event.preventDefault();
  };

  return {
    viewportRef,
    effectiveZoom,
    precise,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onClickCapture,
  };
}

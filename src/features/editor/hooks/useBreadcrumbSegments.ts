import { useEffect, useMemo, useState } from 'react';

import {
  collapseBreadcrumb,
  splitBreadcrumb,
  type BreadcrumbSegments,
  type CrumbItem,
} from '../breadcrumb';

/**
 * 面包屑文本宽度测量（canvas，惰性初始化）。字体与 CSS 一致。
 * 无 canvas 环境（测试/SSR）回退按字符数估算。
 */
const UI_FONT =
  '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';

let measureCtx: CanvasRenderingContext2D | null = null;

function textWidth(text: string): number {
  if (!measureCtx) {
    const canvas = document.createElement('canvas');
    measureCtx = canvas.getContext('2d');
  }
  if (!measureCtx) return text.length * 7;
  measureCtx.font = UI_FONT;
  return measureCtx.measureText(text).width;
}

/** 脏点宽度占位 + 容器左右余量 */
const DIRTY_DOT_W = 12;
const CRUMB_PAD = 4;

export interface UseBreadcrumbSegmentsResult {
  /** 当前可见面包屑段（按预算折叠后） */
  items: CrumbItem[];
  /** 完整分段（含被折叠部分），用于 tooltip / 展开等 */
  segments: BreadcrumbSegments;
  /** 当前像素预算 */
  budget: number;
}

/**
 * 面包屑折叠 hook：监听面包屑容器宽度（ResizeObserver），
 * 用 canvas 测量各段宽度，按预算折叠中间目录。
 *
 * 面包屑容器是 flex-1 min-w-0，宽度由布局固定（按钮栏 shrink-0 不参与），
 * 因此「容器宽 = 面包屑可用宽」，折叠不改变容器宽度，无反馈循环。
 */
export function useBreadcrumbSegments(
  filePath: string,
  projectPath: string | null,
  containerRef: React.RefObject<HTMLElement | null>,
  isDirty: boolean,
): UseBreadcrumbSegmentsResult {
  const [width, setWidth] = useState(0);

  // 脏点在文件名后占用少量宽度，从预算中扣除
  const extra = isDirty ? DIRTY_DOT_W : 0;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      setWidth(Math.max(0, el.clientWidth));
    };
    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const budget = Math.max(60, width - extra - CRUMB_PAD);

  const segments = useMemo(() => splitBreadcrumb(filePath, projectPath), [filePath, projectPath]);

  const items = useMemo(
    () => collapseBreadcrumb(segments, budget, { measure: textWidth }),
    [segments, budget],
  );

  return { items, segments, budget };
}

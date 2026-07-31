import { useEffect, useRef, useState } from 'react';

import type { CommitDetail, CommitFileChange } from '@/features/git/types';

export interface UseExpandPanelOptions {
  selectedHash: string | null;
  selectedExpanded: boolean;
  detail: CommitDetail | null;
  files: CommitFileChange[];
  detailLoading: boolean;
  detailError: string | null;
}

/**
 * 内联展开面板高度测量。
 *
 * 不变量：面板位于虚拟窗口外（expandRef 为 null）时保留上次高度，
 * 保证 rowOffsets / 总高度在滚动期间稳定。
 */
export function useExpandPanel({
  selectedHash,
  selectedExpanded,
  detail,
  files,
  detailLoading,
  detailError,
}: UseExpandPanelOptions) {
  const [expandHeight, setExpandHeight] = useState(0);
  const expandRef = useRef<HTMLDivElement>(null);

  // 选中清空时归零（延迟避免同步 setState 级联渲染）
  useEffect(() => {
    if (!selectedExpanded || !selectedHash) {
      Promise.resolve().then(() => setExpandHeight(0));
    }
  }, [selectedExpanded, selectedHash]);

  // 测量展开面板高度
  useEffect(() => {
    if (!selectedExpanded || !selectedHash) return;
    const el = expandRef.current;
    if (!el) {
      // 面板可能滚出虚拟窗口：保留上次高度，滚动期间总高度稳定
      return;
    }
    const measure = () => setExpandHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [selectedExpanded, selectedHash, detail, files, detailLoading, detailError]);

  return { expandRef, expandHeight };
}

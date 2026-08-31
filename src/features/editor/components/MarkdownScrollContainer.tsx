import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import type { ViewVariant } from '@/shared/utils/editorViewState';
import { getViewSnapshot, setViewSnapshot } from '@/shared/utils/editorViewState';

interface MarkdownScrollContainerProps {
  tabKey: string;
  tabId: string;
  content: string;
  children: React.ReactNode;
  /** editorViewState 快照 variant，默认 'markdown'（JSON 预览复用时传 'json'） */
  variant?: ViewVariant;
}

/**
 * Markdown preview 滚动容器：在 tab 切换时保存/恢复 scrollTop。
 * 内容变化（content 改动）时，保留 scrollTop 但 clamp 到新的最大可滚动值。
 */
function MarkdownScrollContainer({
  tabKey,
  tabId,
  content,
  children,
  variant = 'markdown',
}: MarkdownScrollContainerProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // 挂载 + 内容变化后恢复 scrollTop（用 layoutEffect 抢在浏览器绘制前）
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const snap = getViewSnapshot(tabKey, tabId, variant);
    if (!snap) return;
    // 内容渲染可能尚未完成（图片/mermaid 异步）；先尝试一次，再 rAF 兜底
    const apply = () => {
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.min(snap.scrollTop, max);
    };
    apply();
    const raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
  }, [tabKey, tabId, content, variant]);

  const handleScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setViewSnapshot(tabKey, tabId, variant, { scrollTop: el.scrollTop });
  }, [tabKey, tabId, variant]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (!el) return;
      setViewSnapshot(tabKey, tabId, variant, { scrollTop: el.scrollTop });
    };
  }, [tabKey, tabId, variant]);

  return (
    <div ref={ref} onScroll={handleScroll} className="h-full overflow-y-auto px-6 py-4">
      {children}
    </div>
  );
}

export default React.memo(MarkdownScrollContainer);

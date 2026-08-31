import React, { useEffect, useMemo, useRef } from 'react';

import { getViewSnapshot, setViewSnapshot } from '@/shared/utils/editorViewState';

interface SvgPreviewProps {
  tabKey: string;
  tabId: string;
  /** SVG 文本内容（脏编辑实时反映） */
  content: string;
  fileName: string;
}

/**
 * SVG 文件预览：iframe srcDoc 渲染，样式与应用隔离。
 *
 * - 透明背景，不覆盖 SVG 自带背景色
 * - 内容编辑实时刷新（srcDoc 由 content 派生）
 * - tab 切换时保存/恢复滚动位置（与 Markdown/HTML 预览一致，editorViewState）
 * - sandbox 仅授予 allow-same-origin：不执行 SVG 内嵌脚本（P8 安全沙盒）
 */
function SvgPreview({ tabKey, tabId, content, fileName }: SvgPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const htmlContent = useMemo(
    () =>
      `<!DOCTYPE html><html><head><style>` +
      `html,body{margin:0;padding:0;background:transparent}` +
      `body{display:flex;justify-content:center;overflow:auto}` +
      `svg{max-width:100%;height:auto;display:block}` +
      `</style></head><body>${content}</body></html>`,
    [content],
  );

  // iframe load 完成后恢复上次 scrollTop 并挂滚动监听
  const handleLoad = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) return;

    const snap = getViewSnapshot(tabKey, tabId, 'svg');
    if (snap) {
      requestAnimationFrame(() => {
        try {
          const max = Math.max(0, (doc.documentElement.scrollHeight || 0) - (win.innerHeight || 0));
          win.scrollTo(0, Math.min(snap.scrollTop, max));
        } catch {
          // sandbox 收紧或跨域时静默失败
        }
      });
    }

    const onScroll = () => {
      try {
        const y = win.scrollY || doc.documentElement.scrollTop || doc.body?.scrollTop || 0;
        setViewSnapshot(tabKey, tabId, 'svg', { scrollTop: y });
      } catch {
        // ignore
      }
    };
    win.addEventListener('scroll', onScroll, { passive: true });
    (iframe as unknown as { __neekoCleanup?: () => void }).__neekoCleanup = () => {
      try {
        win.removeEventListener('scroll', onScroll);
      } catch {
        // ignore
      }
    };
  };

  // 卸载时保存一次滚动位置并清理监听
  useEffect(() => {
    const iframe = iframeRef.current;
    return () => {
      if (!iframe) return;
      try {
        const win = iframe.contentWindow;
        const doc = iframe.contentDocument;
        if (win && doc) {
          const y = win.scrollY || doc.documentElement.scrollTop || doc.body?.scrollTop || 0;
          setViewSnapshot(tabKey, tabId, 'svg', { scrollTop: y });
        }
      } catch {
        // ignore
      }
      const cleanup = (iframe as unknown as { __neekoCleanup?: () => void }).__neekoCleanup;
      if (cleanup) cleanup();
    };
  }, [tabKey, tabId]);

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <iframe
        ref={iframeRef}
        srcDoc={htmlContent}
        // 不授予 allow-scripts：SVG 是已知脚本载体，预览无需脚本；
        // allow-same-origin 供父页面挂滚动监听（editorViewState 恢复）
        sandbox="allow-same-origin"
        className="w-full h-full border-none"
        title={`Preview: ${fileName}`}
        onLoad={handleLoad}
      />
    </div>
  );
}

export default React.memo(SvgPreview);

import React, { useEffect, useMemo, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  getViewSnapshot,
  setViewSnapshot,
} from "../../utils/editorViewState";

interface InlineHtmlPreviewProps {
  tabKey: string;
  tabId: string;
  content: string;
  basePath?: string;
  fileName: string;
}

/**
 * Renders HTML file content inside a sandboxed iframe.
 *
 * - Injects a <base href> tag so relative asset paths resolve correctly via
 *   Tauri's asset protocol.
 * - Injects an anchor-click interceptor so in-page hash links scroll smoothly
 *   instead of triggering iframe navigation.
 * - Restores/saves scrollY across tab switches via editorViewState cache.
 *
 * Security note: `allow-scripts allow-same-origin` is intentional — the iframe
 * renders local HTML files authored by the user, so script execution is
 * expected. The combination allows the injected anchor-fix script to run while
 * still sandboxing external network requests.
 */
function InlineHtmlPreview({ tabKey, tabId, content, basePath, fileName }: InlineHtmlPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const htmlContent = useMemo(() => {
    let html = content;

    // Inject <base href> so relative-path resources load correctly (case-insensitive match)
    if (basePath) {
      const dirAssetUrl = convertFileSrc(basePath, "asset");
      const baseTag = `<base href="${dirAssetUrl}/">`;
      if (/<head\b/i.test(html)) {
        html = html.replace(/<head\b([^>]*)>/i, (m) => `${m}${baseTag}`);
      } else if (/<html\b/i.test(html)) {
        html = html.replace(/<html\b([^>]*)>/i, (m) => `${m}<head>${baseTag}</head>`);
      } else {
        html = `${baseTag}${html}`;
      }
    }

    // Inject anchor-navigation interceptor so hash links scroll in-place (case-insensitive match)
    const anchorFixScript =
      `<script>(function(){` +
      `document.addEventListener('click',function(e){` +
      `var a=e.target.closest?e.target.closest('a[href^="#"]'):null;` +
      `if(!a)return;` +
      `e.preventDefault();e.stopPropagation();` +
      `var h=a.getAttribute('href');` +
      `if(h&&h.length>1){` +
      `var t=document.getElementById(h.slice(1))||document.querySelector(h);` +
      `if(t)t.scrollIntoView({behavior:'smooth',block:'start'});` +
      `}` +
      `},true);` +
      `})();</script>`;

    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${anchorFixScript}</body>`);
    } else if (/<\/html>/i.test(html)) {
      html = html.replace(/<\/html>/i, `${anchorFixScript}</html>`);
    } else {
      html += anchorFixScript;
    }

    return html;
  }, [content, basePath]);

  // 在 iframe load 完成后绑定滚动监听 + 恢复上次 scrollY
  const handleLoad = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) return;

    const snap = getViewSnapshot(tabKey, tabId, "html");
    if (snap) {
      // 等下一帧让 iframe 完成首屏 layout
      requestAnimationFrame(() => {
        try {
          const max = Math.max(
            0,
            (doc.documentElement.scrollHeight || 0) - (win.innerHeight || 0),
          );
          win.scrollTo(0, Math.min(snap.scrollTop, max));
        } catch {
          // sandbox 收紧或跨域时静默失败
        }
      });
    }

    const onScroll = () => {
      try {
        const y =
          win.scrollY ||
          doc.documentElement.scrollTop ||
          doc.body?.scrollTop ||
          0;
        setViewSnapshot(tabKey, tabId, "html", { scrollTop: y });
      } catch {
        // ignore
      }
    };
    win.addEventListener("scroll", onScroll, { passive: true });
    // 把卸载/重载时的清理函数挂在 iframe 自身，下一次 load 之前调用
    (iframe as unknown as { __neekoCleanup?: () => void }).__neekoCleanup = () => {
      try {
        win.removeEventListener("scroll", onScroll);
      } catch {
        // ignore
      }
    };
  };

  // 卸载时再保存一次（防 onScroll 节流丢最后一帧），并清理监听
  useEffect(() => {
    return () => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      try {
        const win = iframe.contentWindow;
        const doc = iframe.contentDocument;
        if (win && doc) {
          const y =
            win.scrollY ||
            doc.documentElement.scrollTop ||
            doc.body?.scrollTop ||
            0;
          setViewSnapshot(tabKey, tabId, "html", { scrollTop: y });
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
        // allow-scripts: needed for injected anchor-fix script and user HTML interactivity
        // allow-same-origin: needed for convertFileSrc asset:// URLs to load correctly
        sandbox="allow-scripts allow-same-origin"
        className="w-full h-full border-none"
        title={`Preview: ${fileName}`}
        onLoad={handleLoad}
      />
    </div>
  );
}

export default React.memo(InlineHtmlPreview);

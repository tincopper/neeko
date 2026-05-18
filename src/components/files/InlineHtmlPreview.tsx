import React, { useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

interface InlineHtmlPreviewProps {
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
 *
 * Security note: `allow-scripts allow-same-origin` is intentional — the iframe
 * renders local HTML files authored by the user, so script execution is
 * expected. The combination allows the injected anchor-fix script to run while
 * still sandboxing external network requests.
 */
function InlineHtmlPreview({ content, basePath, fileName }: InlineHtmlPreviewProps) {
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

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <iframe
        srcDoc={htmlContent}
        // allow-scripts: needed for injected anchor-fix script and user HTML interactivity
        // allow-same-origin: needed for convertFileSrc asset:// URLs to load correctly
        sandbox="allow-scripts allow-same-origin"
        className="w-full h-full border-none"
        title={`Preview: ${fileName}`}
      />
    </div>
  );
}

export default React.memo(InlineHtmlPreview);

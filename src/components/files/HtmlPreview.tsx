import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { Globe, RefreshCw } from "@/components/icons"
import type { FileContent, FileChangedEvent } from "../../types";
import { useFileChangedEvent } from "../../hooks/useFileChangedEvent";

interface HtmlPreviewProps {
  projectId: string;
  filePath: string;
  fileName: string;
}

/**
 * HTML 文件预览组件
 * 使用 invoke 读取 HTML 源码，iframe sandbox 渲染（含相对路径资源和 CDN 资源）
 */
function HtmlPreview({ projectId, filePath, fileName }: HtmlPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 计算文件所在目录的 asset URL（用于 <base href> 注入，使相对路径资源正确加载）
  const dirAssetUrl = useMemo(() => {
    const dirPath = filePath.replace(/[\\/][^\\/]*$/, "");
    return convertFileSrc(dirPath, "asset");
  }, [filePath]);

  // 通过后端命令读取 HTML 文件内容并通过 srcdoc 渲染
  const loadHtmlContent = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const fileContent = await invoke<FileContent>("read_file_content", {
        projectId,
        filePath,
      });

      if (fileContent.is_binary) {
        throw new Error("Cannot preview binary file");
      }

      let htmlContent = fileContent.content;

      // 注入 <base href="..."> 标签到 HTML 头部，使相对路径的 CSS/JS/图片能正确解析
      const baseTag = `<base href="${dirAssetUrl}/">`;

      if (htmlContent.includes("<head>")) {
        htmlContent = htmlContent.replace("<head>", `<head>${baseTag}`);
      } else if (htmlContent.includes("<HEAD>")) {
        htmlContent = htmlContent.replace("<HEAD>", `<HEAD>${baseTag}`);
      } else if (htmlContent.includes("<html>")) {
        htmlContent = htmlContent.replace("<html>", `<html><head>${baseTag}</head>`);
      } else if (htmlContent.includes("<HTML>")) {
        htmlContent = htmlContent.replace("<HTML>", `<HTML><HEAD>${baseTag}</HEAD>`);
      } else {
        htmlContent = `${baseTag}${htmlContent}`;
      }

      // 注入锚点导航拦截脚本，防止 <base href> 导致 href="#..." 变成外部导航
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

      if (htmlContent.includes("</body>")) {
        htmlContent = htmlContent.replace("</body>", `${anchorFixScript}</body>`);
      } else if (htmlContent.includes("</html>")) {
        htmlContent = htmlContent.replace("</html>", `${anchorFixScript}</html>`);
      } else {
        htmlContent += anchorFixScript;
      }

      setHtmlContent(htmlContent);
    } catch (err) {
      console.error("[HtmlPreview] Failed to load HTML file:", err);
      setError(err instanceof Error ? err.message : "Failed to load HTML file");
    } finally {
      setIsLoading(false);
    }
  }, [projectId, filePath, dirAssetUrl]);

  // 初始加载和文件路径变化时重新加载
  useEffect(() => {
    loadHtmlContent();

    // 组件卸载时清理
    return () => {
      setHtmlContent(null);
    };
  }, [loadHtmlContent]);

  const normalizedFilePath = filePath.replace(/\\/g, "/");

  // 使用共享的 file-changed 事件订阅（与 useFileTabRefresh / useBrowserPanel 共享同一 IPC 监听）
  useFileChangedEvent(useCallback((event: FileChangedEvent) => {
    const { paths } = event;
    const matched = paths.some((p) => p === normalizedFilePath || p.endsWith("/" + normalizedFilePath));
    if (matched) loadHtmlContent();
  }, [normalizedFilePath, loadHtmlContent]));

  // 处理刷新
  const handleRefresh = useCallback(() => {
    loadHtmlContent();
  }, [loadHtmlContent]);

  // 处理 iframe 加载完成
  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  // 处理 iframe 加载错误
  const handleIframeError = useCallback(() => {
    setError("Failed to load HTML content in preview");
    setIsLoading(false);
  }, []);

  if (error) {
    return (
      <div className="flex-1 flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-secondary/50">
          <Globe size={12} className="text-text-secondary" />
          <span className="text-[var(--font-size)] text-text-secondary truncate">{fileName}</span>
          <div className="flex-1" />
          <button
            className="px-2 py-1 text-[var(--font-size)] rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1"
            onClick={handleRefresh}
            title="Refresh preview"
          >
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-text-secondary">
            <Globe size={48} className="mx-auto mb-3 opacity-30" />
            <p className="text-[var(--font-size)] font-medium text-status-error mb-1">Preview Error</p>
            <p className="text-[var(--font-size)] opacity-60 max-w-md">{error}</p>
            <button
              className="mt-3 px-3 py-1.5 text-[var(--font-size)] rounded bg-bg-hover text-text-primary hover:bg-bg-selected transition-colors"
              onClick={handleRefresh}
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-secondary/50">
        <Globe size={12} className="text-text-secondary" />
        <span className="text-[var(--font-size)] text-text-secondary truncate">{fileName}</span>
        {isLoading && (
          <RefreshCw size={10} className="animate-spin text-text-secondary" />
        )}
        <div className="flex-1" />
        <button
          className="px-2 py-1 text-[var(--font-size)] rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1"
          onClick={handleRefresh}
          title="Refresh preview"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Preview iframe */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-primary/80 z-10">
            <div className="flex flex-col items-center gap-2">
              <RefreshCw size={24} className="animate-spin text-text-secondary" />
              <span className="text-[var(--font-size)] text-text-secondary">Loading preview...</span>
            </div>
          </div>
        )}
         {htmlContent && (
            <iframe
              ref={iframeRef}
              srcDoc={htmlContent}
              sandbox="allow-scripts allow-same-origin"
              className="w-full h-full border-none"
              title={`Preview: ${fileName}`}
              onLoad={handleIframeLoad}
              onError={handleIframeError}
            />
         )}
      </div>
    </div>
  );
}

export default React.memo(HtmlPreview);

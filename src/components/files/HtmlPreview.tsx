import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { Globe, RefreshCw } from "lucide-react";
import type { FileContent } from "../../types";

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
  const blobUrlRef = useRef<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 计算文件所在目录的 asset URL（用于 <base href> 注入，使相对路径资源正确加载）
  const dirAssetUrl = useMemo(() => {
    const dirPath = filePath.replace(/[\\/][^\\/]*$/, "");
    return convertFileSrc(dirPath, "asset");
  }, [filePath]);

  // 通过后端命令读取 HTML 文件内容并创建 blob URL
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

      // 创建 blob URL
      const blob = new Blob([htmlContent], { type: "text/html; charset=utf-8" });
      const url = URL.createObjectURL(blob);

      // 释放旧的 blob URL（通过 ref 避免 stale closure）
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }

      blobUrlRef.current = url;
      setBlobUrl(url);
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

    // 组件卸载时释放 blob URL
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [loadHtmlContent]);

  // 处理刷新
  const handleRefresh = useCallback(() => {
    loadHtmlContent();
  }, [loadHtmlContent]);

  // 处理 iframe 加载完成：将焦点归还父窗口，确保全局快捷键（Ctrl+W 等）可用
  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
    window.focus();
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
        {blobUrl && (
          <>
            <iframe
              ref={iframeRef}
              src={blobUrl}
              sandbox="allow-scripts allow-same-origin"
              className="w-full h-full border-none"
              title={`Preview: ${fileName}`}
              onLoad={handleIframeLoad}
              onError={handleIframeError}
            />
            {/* Transparent overlay: prevent focus entering iframe so Ctrl+W etc. work */}
            <div
              className="absolute inset-0 z-20"
              onMouseDown={(e) => e.preventDefault()}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default React.memo(HtmlPreview);

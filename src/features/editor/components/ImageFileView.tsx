import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useAssetUrl } from '@/shared/hooks/useAssetUrl';
import { useScrollbarCompensation } from '@/shared/hooks/useScrollbarCompensation';
import type { ProjectId } from '@/shared/utils/workspaceRef';

interface ImageFileViewProps {
  /** **Workspace 相对**路径（与 `read_file_content` 同一寻址语义）。 */
  filePath: string;
  fileName: string;
  /**
   * 该 tab 归属 Workspace 的**根**（`workspaceRootOf(workspace.key, projectPath)`）。
   *
   * 必须是 worktree 感知的根，不能是 `project.path`：linked worktree 里同一相对路径
   * 指向的是工作树里的文件，拼到主仓根会解析到**另一个文件**（或不存在的路径）。
   */
  basePath?: string;
  /** 归属项目：用于判定走 asset 协议（Local）还是二进制流（WSL/SSH）。 */
  projectId?: ProjectId;
}

/**
 * 二进制图片文件预览（png/jpg/gif/webp/...）：点击放大遮罩。
 *
 * 通道由 `useAssetUrl` 决定 —— 本地项目走 asset 协议直连，SSH/WSL 项目走
 * `read_file_bytes` 二进制流 → blob URL（asset 协议物理上够不着远程磁盘）。
 *
 * 路径一律是「Workspace 相对 + Workspace 根」：本组件不自己拼项目路径
 * （历史实现接绝对路径，而绝对路径由 `project.path` 派生 ⇒ worktree 下指向主仓）。
 */
function ImageFileView({ filePath, fileName, basePath, projectId }: ImageFileViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 预览容器自身可能溢出（大图）：同样按实测占位补偿右内边
  useScrollbarCompensation(scrollRef);
  const [overlay, setOverlay] = useState(false);
  // 按「哪个 filePath 失败」派生错误态：tab 复用组件时不需复位 effect。
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const loadError = failedFor === filePath;

  const { url: src, loading, error } = useAssetUrl(filePath, basePath, projectId);

  useEffect(() => {
    if (loadError) {
      console.warn('[ImageFileView] asset load failed', { filePath, basePath, src: src ?? null });
    }
  }, [loadError, filePath, basePath, src]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOverlay(false);
  }, []);

  if (error || loadError) {
    // 失败原因必须可见：图片加载失败可能来自 asset 协议 scope 拒绝（403）、路径解析错误、
    // 远程字节通道异常。只显示文件名会让排查退化成猜 —— 完整原因同时进 console。
    return (
      <div
        className="h-full flex flex-col items-center justify-center gap-1 text-text-muted text-sm px-4 text-center"
        title={error ?? `Failed to load: ${src ?? filePath}`}
      >
        <span>Image failed to load: {fileName}</span>
        <span className="text-xs break-all opacity-70">
          {error ?? `asset URL rejected or file missing: ${src ?? filePath}`}
        </span>
      </div>
    );
  }

  if (!src) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        {loading ? 'Loading image…' : `Image unavailable: ${fileName}`}
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full flex items-center justify-center p-4 overflow-auto">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <img
        src={src}
        alt={fileName}
        className="max-w-full max-h-full object-contain cursor-zoom-in"
        onClick={() => setOverlay(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOverlay(true);
          }
        }}
        onError={() => setFailedFor(filePath)}
      />
      {overlay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-zoom-out"
          onClick={() => setOverlay(false)}
          onKeyDown={handleKeyDown}
          role="button"
          tabIndex={0}
          aria-label="Close image preview"
        >
          <img src={src} alt="" className="max-w-[90vw] max-h-[90vh] object-contain" />
        </div>
      )}
    </div>
  );
}

export default React.memo(ImageFileView);

// eslint-disable-next-line no-restricted-imports -- convertFileSrc is needed for rendering local binary image files via asset protocol
import { convertFileSrc } from '@tauri-apps/api/core';
import React, { useCallback, useState } from 'react';

interface ImageFileViewProps {
  /** 文件绝对路径（本地项目） */
  absPath: string;
  fileName: string;
}

/**
 * 二进制图片文件预览（png/jpg/gif/...）：asset URL 渲染 + 点击放大遮罩。
 * 仅本地项目使用 —— asset 协议无法访问 SSH/WSL 远程文件（上层分支已保证）。
 */
function ImageFileView({ absPath, fileName }: ImageFileViewProps) {
  const [overlay, setOverlay] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const src = convertFileSrc(absPath);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOverlay(false);
  }, []);

  if (loadError) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        Image failed to load: {fileName}
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center p-4 overflow-auto">
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
        onError={() => setLoadError(true)}
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

import React, { useMemo, useRef } from 'react';

import { cn } from '@/lib/utils';
import { Eye, FileCode, Globe, ExternalLink, Search, Sparkles } from '@/shared/components/icons';
import { fileIconSrc } from '@/shared/utils/fileIcons';

import { useBreadcrumbSegments } from '../hooks/useBreadcrumbSegments';
import type { PreviewMode } from '../types';

interface EditorHeaderProps {
  /** 文件路径（可绝对或相对项目根，兼容本地/WSL/SSH） */
  filePath: string;
  /** 项目根路径，用于相对面包屑显示 */
  projectPath: string | null;
  /** 未保存状态（脏点 ●） */
  isDirty: boolean;
  isMd: boolean;
  isHtml: boolean;
  isSvg: boolean;
  isJson: boolean;
  previewMode: PreviewMode;
  onTogglePreview: () => void;
  onOpenInBrowser?: () => void;
  onOpenInSystemBrowser?: () => void;
  canOpenInBrowser?: boolean;
  /** 页内内容搜索（打开 CodeMirror 查找面板） */
  onSearch?: () => void;
  /** AI 助手 */
  onAI?: () => void;
}

/** 项目根目录图标 */
const FOLDER_ICON = '/icons/_folder.svg';

/**
 * 编辑器头部：VS Code / IDEA 风格面包屑 + 按钮栏（搜索 / AI / 上下文操作）。
 * Save 已移除（Ctrl+S 快捷键 + 脏点 ● 承担提示职责）。
 */
function EditorHeader({
  filePath,
  projectPath,
  isDirty,
  isMd,
  isHtml,
  isSvg,
  isJson,
  previewMode,
  onTogglePreview,
  onOpenInBrowser,
  onOpenInSystemBrowser,
  canOpenInBrowser,
  onSearch,
  onAI,
}: EditorHeaderProps) {
  const crumbRef = useRef<HTMLDivElement>(null);
  const { items, segments } = useBreadcrumbSegments(filePath, projectPath, crumbRef, isDirty);

  // 完整绝对路径（tooltip），文件已为绝对时原样，否则拼项目根
  const fullPath = useMemo(() => {
    if (!filePath) return '';
    if (/^\/|[A-Za-z]:[\\/]/.test(filePath)) return filePath;
    if (!projectPath) return filePath;
    return `${projectPath.replace(/[/\\]+$/, '')}/${filePath.replace(/^[/\\]+/, '')}`;
  }, [filePath, projectPath]);

  const fileIcon = useMemo(
    () => (segments.fileName ? fileIconSrc(segments.fileName) : undefined),
    [segments.fileName],
  );

  return (
    <div className="flex items-center gap-2 px-3 py-1 border-b border-border/20 bg-bg-secondary/50">
      {/* 面包屑（VS Code / IDEA 风格） */}
      <div
        ref={crumbRef}
        title={fullPath}
        className="flex-1 flex items-center gap-0.5 text-xs min-w-0 overflow-hidden"
      >
        {items.map((item, i) => (
          <React.Fragment key={`${item.kind}-${i}`}>
            {i > 0 && (
              <span className="shrink-0 opacity-40 select-none" aria-hidden="true">
                ›
              </span>
            )}
            <span
              className={cn(
                'flex items-center gap-1 px-1 rounded shrink-0 whitespace-nowrap select-none',
                item.kind === 'root' && 'text-text-muted',
                item.kind === 'dir' &&
                  'text-text-secondary hover:bg-bg-hover hover:text-text-primary cursor-pointer',
                item.kind === 'more' && 'text-text-muted cursor-pointer',
                item.kind === 'file' && 'text-text-primary font-medium',
              )}
              title={
                item.kind === 'more'
                  ? '中间目录已折叠，完整路径见悬停提示'
                  : item.kind === 'file'
                    ? fullPath
                    : undefined
              }
            >
              {item.kind === 'root' && (
                <img
                  src={FOLDER_ICON}
                  alt=""
                  className="w-3.5 h-3.5 object-contain"
                  draggable={false}
                />
              )}
              {item.kind === 'file' && fileIcon && (
                <img
                  src={fileIcon}
                  alt=""
                  className="w-3.5 h-3.5 object-contain"
                  draggable={false}
                />
              )}
              <span className="truncate">{item.text}</span>
            </span>
          </React.Fragment>
        ))}
        {isDirty && (
          <span
            className="ml-1 text-accent-yellow shrink-0 select-none"
            title="未保存修改（Ctrl+S 保存）"
          >
            ●
          </span>
        )}
      </div>

      {/* 按钮栏：纯图标 + hover tooltip 显示文字 */}
      <div className="flex items-center gap-1 shrink-0">
        {onSearch && (
          <button
            className="tb-icon-btn w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
            onClick={onSearch}
            title="查找（页内搜索，Ctrl+F）"
            aria-label="查找（页内搜索）"
          >
            <Search size={14} />
          </button>
        )}

        {onAI && (
          <button
            className="tb-icon-btn w-6 h-6 rounded-md flex items-center justify-center text-accent-blue hover:bg-bg-hover hover:text-text-primary transition-colors"
            onClick={onAI}
            title="AI 助手"
            aria-label="AI 助手"
          >
            <Sparkles size={14} />
          </button>
        )}

        {/* Markdown / HTML / SVG / JSON preview toggle */}
        {(isMd || isHtml || isSvg || isJson) && (
          <button
            className="tb-icon-btn w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
            onClick={onTogglePreview}
            title={previewMode === 'preview' ? '切换到源码' : '切换预览'}
            aria-label="切换预览/源码"
          >
            {previewMode === 'preview' ? <FileCode size={14} /> : <Eye size={14} />}
          </button>
        )}

        {/* HTML: Open in Browser Panel */}
        {isHtml && canOpenInBrowser && (
          <button
            className="tb-icon-btn w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
            onClick={onOpenInBrowser}
            title="浏览器面板打开"
            aria-label="浏览器面板打开"
          >
            <Globe size={14} />
          </button>
        )}

        {/* HTML: Open in System Browser */}
        {isHtml && canOpenInBrowser && onOpenInSystemBrowser && (
          <button
            className="tb-icon-btn w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
            onClick={onOpenInSystemBrowser}
            title="系统浏览器打开"
            aria-label="系统浏览器打开"
          >
            <ExternalLink size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export default React.memo(EditorHeader);

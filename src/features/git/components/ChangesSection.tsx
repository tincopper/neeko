import React from 'react';

import { cn } from '@/lib/utils';
import { ChevronRightIcon, FileCode2, Undo2, Plus, Minus } from '@/shared/components/icons';
import type { FileChange } from '@/shared/types';
import { fileIconSrc } from '@/shared/utils/fileIcons';
import { Checkbox } from '@/ui/Checkbox';

// ── Path utilities ───────────────────────────────────────────────────────────

function splitFilePath(path: string): { name: string; directory: string } {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash === -1) return { name: path, directory: '' };
  return {
    name: path.slice(lastSlash + 1),
    directory: path.slice(0, lastSlash + 1),
  };
}

export interface SectionProps {
  title: string;
  count: number;
  additions?: number;
  deletions?: number;
  expanded: boolean;
  onToggle: () => void;
  files: FileChange[];
  selectedFiles: Set<string>;
  allSelected: boolean;
  onSelectAll: () => void;
  onToggleFile: (path: string) => void;
  onFileSelect?: (path: string) => void;
  onDiscardFile: (path: string) => void;
  onStageFile?: (path: string) => void;
  /** 在编辑器中打开该文件（Open File 快捷跳转）；未提供则不渲染按钮 */
  onOpenFile?: (path: string) => void;
  loading: boolean;
  filter?: React.ReactNode;
  headerAction?: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({
  title,
  count,
  additions,
  deletions,
  expanded,
  onToggle,
  files,
  selectedFiles,
  allSelected,
  onSelectAll,
  onToggleFile,
  onFileSelect,
  onDiscardFile,
  onStageFile,
  onOpenFile,
  loading,
  filter,
  headerAction,
}) => {
  return (
    <div className="flex flex-col shrink-0 mb-1">
      {/* Header: Chevron → Checkbox → Title → Count → Stats → Filter */}
      <div className="flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors duration-100 hover:bg-bg-hover select-none shrink-0">
        <ChevronRightIcon
          size={9}
          className={cn(
            'text-[0.6em] w-2.5 shrink-0 transition-transform duration-150 text-text-muted cursor-pointer',
            expanded && 'rotate-90',
          )}
          onClick={onToggle}
        />
        <Checkbox checked={allSelected} onCheckedChange={onSelectAll} />
        <span
          role="button"
          tabIndex={0}
          className="text-[calc(var(--font-size)-2px)] font-semibold uppercase tracking-[0.06em] text-text-muted cursor-pointer hover:text-text-secondary"
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle();
            }
          }}
        >
          {title} ({count})
        </span>
        {additions != null && additions > 0 && (
          <span className="text-[#3fb950] text-[calc(var(--font-size)-2px)] font-semibold">
            +{additions}
          </span>
        )}
        {deletions != null && deletions > 0 && (
          <span className="text-[#f85149] text-[calc(var(--font-size)-2px)] font-semibold">
            -{deletions}
          </span>
        )}
        {filter && <span className="ml-auto">{filter}</span>}
        {headerAction && <span className={cn(!filter && 'ml-auto')}>{headerAction}</span>}
      </div>

      {/* File list */}
      {expanded && (
        <div className="flex flex-col">
          {files.map((file) => {
            const isSelected = selectedFiles.has(file.path);
            // 尾斜杠为折叠目录条目占位行（子文件列表拉取中），显示名剥离尾斜杠
            const { name, directory } = splitFilePath(file.path.replace(/\/+$/, ''));
            return (
              <div
                key={file.path}
                role="option"
                tabIndex={-1}
                aria-selected={isSelected}
                className={cn(
                  'flex items-center gap-x-1.5 pl-[23px] pr-1.5 py-1 rounded cursor-pointer min-w-0 w-full overflow-hidden transition-colors duration-100 group',
                  isSelected ? 'bg-bg-selected text-text-primary' : 'hover:bg-bg-hover/60',
                )}
                onClick={() => onFileSelect?.(file.path)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onFileSelect?.(file.path);
                  }
                }}
                title={`${file.path}  ${file.additions > 0 ? `+${file.additions}` : ''} ${file.deletions > 0 ? `-${file.deletions}` : ''}`}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleFile(file.path)}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  className="shrink-0"
                />
                <img
                  className="w-3.5 h-3.5 shrink-0 block opacity-70"
                  src={fileIconSrc(file.path)}
                  alt=""
                  width={14}
                  height={14}
                />
                <span
                  className={cn(
                    'shrink-0 max-w-[9rem] truncate text-[calc(var(--font-size)-1px)] font-mono text-text-primary',
                    // 已删除文件：删除线 + 弱化（文件已不存在于工作区）
                    file.status === 'Deleted' && 'line-through text-text-muted',
                  )}
                >
                  {name}
                </span>
                <span className="flex-1 min-w-0 truncate text-[calc(var(--font-size)-3px)] font-mono text-text-muted">
                  {directory}
                </span>
                <span className="shrink-0 flex items-center gap-1 justify-end tabular-nums">
                  {file.additions > 0 && (
                    <span className="flex items-center gap-px text-accent-green whitespace-nowrap">
                      <Plus size={9} />
                      <span className="text-[calc(var(--font-size)-2px)]">{file.additions}</span>
                    </span>
                  )}
                  {file.deletions > 0 && (
                    <span className="flex items-center gap-px text-accent-red whitespace-nowrap">
                      <Minus size={9} />
                      <span className="text-[calc(var(--font-size)-2px)]">{file.deletions}</span>
                    </span>
                  )}
                </span>
                <span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                  {onOpenFile && (
                    <button
                      className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-100"
                      title="Open File"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenFile(file.path);
                      }}
                      disabled={loading}
                    >
                      <FileCode2 size={12} />
                    </button>
                  )}
                  <button
                    className="p-0.5 rounded text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors duration-100"
                    title="Discard changes"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDiscardFile(file.path);
                    }}
                    disabled={loading}
                  >
                    <Undo2 size={12} />
                  </button>
                  {onStageFile && (
                    <button
                      className="p-0.5 rounded text-text-muted hover:text-accent-green hover:bg-bg-hover transition-colors duration-100"
                      title="Stage file (git add)"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStageFile(file.path);
                      }}
                      disabled={loading}
                    >
                      <Plus size={12} />
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default React.memo(Section);

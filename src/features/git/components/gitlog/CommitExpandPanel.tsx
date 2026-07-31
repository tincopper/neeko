import { useMemo } from 'react';
import type { ReactNode, RefObject } from 'react';

import type { CommitDetail, CommitFileChange } from '@/features/git/types';
import { cn } from '@/lib/utils';
import { FilePlus, FileText, Minus, Pencil, Plus, Trash2 } from '@/shared/components/icons';

import { commitBodyPreview, splitFilePath } from './commitListUtils';

/** 展开面板最大高度——限制列表跳动并保证 graph 偏移可预测。 */
const EXPAND_MAX_HEIGHT = 280;

/** 面板主体滚动区（常量样式，避免 JSX 内联对象重建） */
const EXPAND_BODY_STYLE = { maxHeight: EXPAND_MAX_HEIGHT, overflowY: 'auto' as const };

const STATUS_ICONS: Record<string, { icon: ReactNode; color: string }> = {
  M: { icon: <Pencil size={11} />, color: 'text-accent-blue' },
  A: { icon: <FilePlus size={11} />, color: 'text-accent-green' },
  D: { icon: <Trash2 size={11} />, color: 'text-accent-red' },
  R: { icon: <FileText size={11} />, color: 'text-accent-orange' },
};

export interface CommitExpandPanelProps {
  detail: CommitDetail | null;
  files: CommitFileChange[];
  detailLoading: boolean;
  detailError: string | null;
  /** 键盘聚焦文件索引（-1 = 无） */
  focusedFileIndex?: number;
  /** 面板左缩进：由组合层按该行 rowMaxX 计算 */
  marginLeft: number;
  /** useExpandPanel 测量用（ref drilling，属预期） */
  expandRef: RefObject<HTMLDivElement>;
  onOpenDiff: (filePath: string) => void;
  onPinFile: (filePath: string) => void;
}

/**
 * 内联展开详情面板（files-first，max-height 滚动）。
 * 纯展示：data-in, events-out。
 */
export function CommitExpandPanel({
  detail,
  files,
  detailLoading,
  detailError,
  focusedFileIndex = -1,
  marginLeft,
  expandRef,
  onOpenDiff,
  onPinFile,
}: CommitExpandPanelProps) {
  const fileStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const f of files) {
      additions += f.additions;
      deletions += f.deletions;
    }
    return { additions, deletions, count: files.length };
  }, [files]);

  return (
    <div
      ref={expandRef}
      className="commit-expand relative z-10 mr-1 mt-0.5 mb-0.5 rounded-md border border-border/40 bg-bg-tertiary/40 min-w-0 overflow-hidden"
      style={{ marginLeft }}
    >
      {detailLoading ? (
        <div className="text-[var(--font-size)] text-text-muted px-3 py-2">Loading details…</div>
      ) : detailError ? (
        <div className="text-[var(--font-size)] text-accent-red px-3 py-2">{detailError}</div>
      ) : detail ? (
        <div className="px-2.5 py-2" style={EXPAND_BODY_STYLE}>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mb-1 text-[calc(var(--font-size)-1px)]">
            <span className="font-mono text-accent-blue">{detail.short_hash}</span>
            <span className="text-text-muted">·</span>
            <span className="text-text-muted">
              parents: {detail.parents.map((p) => p.slice(0, 7)).join(', ') || '—'}
            </span>
          </div>
          {commitBodyPreview(detail.message) ? (
            <p className="text-[calc(var(--font-size)-2px)] text-text-secondary leading-snug mb-1.5 whitespace-pre-wrap line-clamp-2">
              {commitBodyPreview(detail.message)}
            </p>
          ) : null}
          <div className="flex items-center gap-2 text-[calc(var(--font-size)-2px)] text-text-muted mb-1 border-t border-border/40 pt-1">
            <span>
              {fileStats.count} {fileStats.count === 1 ? 'file' : 'files'}
            </span>
            <span className="flex items-center gap-px text-accent-green">
              <Plus size={9} />
              {fileStats.additions}
            </span>
            <span className="flex items-center gap-px text-accent-red">
              <Minus size={9} />
              {fileStats.deletions}
            </span>
          </div>
          <div>
            {files.map((f, idx) => {
              const statusInfo = STATUS_ICONS[f.status] ?? STATUS_ICONS.M;
              const isFocused = idx === focusedFileIndex;
              const { name, dir } = splitFilePath(f.path);
              return (
                <div
                  key={f.path}
                  role="button"
                  tabIndex={-1}
                  data-testid={`commit-file-${f.path}`}
                  className={cn(
                    'flex items-center gap-x-1.5 px-1.5 py-1 rounded cursor-pointer min-w-0 w-full overflow-hidden',
                    // 键盘聚焦专属——文件行无 hover wash
                    isFocused && 'bg-bg-hover/60',
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDiff(f.path);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onPinFile(f.path);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenDiff(f.path);
                    }
                  }}
                  title={`${f.path}  +${f.additions} −${f.deletions}\nClick: open diff · Double-click: pin tab`}
                >
                  <span className={cn(statusInfo.color, 'shrink-0')}>{statusInfo.icon}</span>
                  {/* filename 优先；只有 dir 列收窄省略 */}
                  <span
                    className="shrink-0 max-w-[9rem] truncate text-[calc(var(--font-size)-1px)] font-mono text-text-primary"
                    title={name}
                  >
                    {name}
                  </span>
                  <span
                    className={cn(
                      'flex-1 min-w-0 truncate text-[calc(var(--font-size)-3px)] font-mono text-text-muted',
                      !dir && 'invisible',
                    )}
                    title={dir}
                  >
                    {dir || '—'}
                  </span>
                  <span className="shrink-0 flex items-center gap-1 justify-end tabular-nums">
                    <span className="flex items-center gap-px text-accent-green whitespace-nowrap">
                      <Plus size={9} />
                      <span className="text-[calc(var(--font-size)-2px)]">{f.additions}</span>
                    </span>
                    <span className="flex items-center gap-px text-accent-red whitespace-nowrap">
                      <Minus size={9} />
                      <span className="text-[calc(var(--font-size)-2px)]">{f.deletions}</span>
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-1 text-[calc(var(--font-size)-3px)] text-text-muted leading-tight">
            Click open · Double-click pin · J/K commits · j/k files
          </div>
        </div>
      ) : (
        <div className="text-[var(--font-size)] text-text-muted px-3 py-2">No details</div>
      )}
    </div>
  );
}

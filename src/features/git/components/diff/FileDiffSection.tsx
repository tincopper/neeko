import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { ChevronRight } from '@/shared/components/icons';
import { fileIconSrc } from '@/shared/utils/fileIcons';

import DiffTable from './DiffTable';
import {
  fileBlockId,
  splitFilePath,
  statusBadgeClass,
  statusLetter,
  type SelectionMode,
} from './diffViewUtils';
import { detectLanguage, ensureLanguageRegistered } from './highlight';
import SplitDiffTable from './SplitDiffTable';
import type { DiffHunk, DiffViewProps, ViewMode } from './types';
import { useDiffData } from './useDiffData';

/** Shared chrome for single + combined file blocks (rounded card + optional header). */
interface DiffFileCardProps {
  filePath: string;
  status?: string;
  additions?: number;
  deletions?: number;
  expanded: boolean;
  active?: boolean;
  /**
   * Combined mode shows the file header (name/dir/stats/toggle).
   * Single mode hides it — toolbar already carries that identity (avoids double chrome).
   */
  showHeader?: boolean;
  /** When set, header is a toggle control. */
  onToggle?: () => void;
  children?: React.ReactNode;
  className?: string;
  id?: string;
}

export const DiffFileCard: React.FC<DiffFileCardProps> = React.memo(
  ({
    filePath,
    status,
    additions = 0,
    deletions = 0,
    expanded,
    active = false,
    showHeader = true,
    onToggle,
    children,
    className,
    id,
  }) => {
    const { name, dir } = useMemo(() => splitFilePath(filePath), [filePath]);
    const letter = status ? statusLetter(status) : '';
    const interactive = typeof onToggle === 'function';

    const headerClass = cn(
      'sticky top-0 z-10 w-full grid grid-cols-[14px_16px_minmax(0,auto)_minmax(0,1fr)_auto_auto] items-center gap-1.5 px-3 py-1.5 text-left transition-colors',
      'bg-bg-secondary',
      interactive && 'hover:bg-bg-hover/50 cursor-pointer',
      expanded && 'border-b border-border/35',
      active && 'bg-bg-selected/40',
    );

    const headerInner = (
      <>
        <ChevronRight
          size={12}
          className={cn(
            'text-text-secondary shrink-0 transition-transform duration-150',
            expanded && 'rotate-90 text-text-primary',
            !interactive && 'opacity-50',
          )}
        />
        <img
          src={fileIconSrc(name)}
          alt=""
          width={14}
          height={14}
          className="shrink-0 opacity-90"
        />
        <span className="truncate max-w-[12rem] text-[var(--font-size)] font-semibold text-text-primary">
          {name}
        </span>
        <span className="min-w-0 truncate font-mono text-[calc(var(--font-size)-2px)] text-text-secondary">
          {dir}
        </span>
        {letter ? (
          <span
            className={cn(
              'shrink-0 text-[calc(var(--font-size)-3px)] font-semibold px-1.5 py-px rounded-full leading-none',
              statusBadgeClass(letter),
            )}
          >
            {letter}
          </span>
        ) : (
          <span className="shrink-0 w-0 overflow-hidden" />
        )}
        <span className="shrink-0 flex items-center gap-1 text-[calc(var(--font-size)-2px)] tabular-nums font-medium">
          <span className="text-accent-green">+{additions}</span>
          <span className="text-accent-red">−{deletions}</span>
        </span>
      </>
    );

    return (
      <section
        id={id}
        className={cn(
          // Same surface as tab chrome; soft rounded card for single + combined.
          'mx-2 my-1.5 overflow-hidden rounded-lg border bg-bg-secondary',
          active ? 'border-border' : 'border-border/40',
          className,
        )}
      >
        {showHeader ? (
          interactive ? (
            <button
              type="button"
              className={headerClass}
              onClick={onToggle}
              aria-expanded={expanded}
              title={filePath}
            >
              {headerInner}
            </button>
          ) : (
            <div className={headerClass} title={filePath}>
              {headerInner}
            </div>
          )
        ) : null}

        {expanded ? <div className="bg-bg-secondary px-2 py-1.5">{children}</div> : null}
      </section>
    );
  },
);
DiffFileCard.displayName = 'DiffFileCard';

interface FileDiffSectionProps {
  projectId: string;
  diffSource: NonNullable<DiffViewProps['diffSource']>;
  filePath: string;
  status: string;
  additions: number;
  deletions: number;
  viewMode: ViewMode;
  expanded: boolean;
  active: boolean;
  onToggle: () => void;
  selectedLines: Set<string>;
  onToggleLine: (hunkIdx: number, lineIdx: number) => void;
  /** 全文模式（collapse=false）。 */
  collapse: boolean;
  /** 拖拽选区提交（key 已带文件前缀）。 */
  onDragCommit: (keys: Set<string>, mode: SelectionMode) => void;
  /** 单段展开（key 已带文件前缀）。 */
  expandedSections: Set<string>;
  onToggleSection: (hunkIdx: number, lineIdx: number) => void;
  /** 向父级上报本文件的渲染 hunks（combined review 拼 diff 文本用）。 */
  onDiffResult?: (filePath: string, hunks: DiffHunk[] | null) => void;
  /** 选中块末尾的浮动工具条内容（跨列行渲染，随选中行滚动）。 */
  selectionActionBar?: () => React.ReactNode;
}

const FileDiffSection: React.FC<FileDiffSectionProps> = React.memo(
  ({
    projectId,
    diffSource,
    filePath,
    status,
    additions,
    deletions,
    viewMode,
    expanded,
    active,
    onToggle,
    selectedLines,
    onToggleLine,
    collapse,
    onDragCommit,
    expandedSections,
    onToggleSection,
    onDiffResult,
    selectionActionBar,
  }) => {
    // Gate data loading until expanded (D2 performance).
    const { diffResult, fullHunks, loadFullHunks, loading, error, loadDiff } = useDiffData({
      projectId,
      diffSource,
      filePath: expanded ? filePath : '',
      collapse,
    });

    // 数据提升：把渲染 hunks 上报给 DiffView（combined review 拼 diff 文本用）。
    useEffect(() => {
      onDiffResult?.(filePath, diffResult?.hunks ?? null);
    }, [filePath, diffResult, onDiffResult]);

    const language = useMemo(() => detectLanguage(filePath), [filePath]);
    const blockId = fileBlockId(filePath);
    const [languageReady, setLanguageReady] = useState(false);

    useEffect(() => {
      if (!expanded) return;
      let cancelled = false;
      void ensureLanguageRegistered(language).then(() => {
        if (!cancelled) setLanguageReady(true);
      });
      return () => {
        cancelled = true;
      };
    }, [expanded, language]);

    const handleToggleSection = useCallback(
      (hunkIdx: number, lineIdx: number) => {
        // 仅在真正展开时由本文件实例按需加载全量 hunks（收起跳过，避免冗余请求）
        const key = `${hunkIdx}:${lineIdx}`;
        const expanding = !expandedSections.has(key);
        onToggleSection(hunkIdx, lineIdx);
        if (expanding) void loadFullHunks();
      },
      [onToggleSection, expandedSections, loadFullHunks],
    );

    return (
      <DiffFileCard
        id={blockId}
        filePath={filePath}
        status={status}
        additions={additions}
        deletions={deletions}
        expanded={expanded}
        active={active}
        onToggle={onToggle}
      >
        {loading ? (
          <div className="text-text-muted text-[var(--font-size)] py-4 text-center">Loading…</div>
        ) : error ? (
          <div className="text-accent-red text-[var(--font-size)] py-4 text-center">
            {error}
            <button
              type="button"
              className="ml-2 text-accent-blue underline bg-transparent border-none cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                void loadDiff();
              }}
            >
              Retry
            </button>
          </div>
        ) : diffResult && diffResult.hunks.length > 0 ? (
          viewMode === 'unified' ? (
            <DiffTable
              diffResult={diffResult}
              language={language}
              languageReady={languageReady}
              selectedLines={selectedLines}
              onToggleLine={onToggleLine}
              onDragCommit={onDragCommit}
              blockIdPrefix={`cb-${blockId}`}
              fullHunks={fullHunks ?? undefined}
              expandedSections={expandedSections}
              onToggleSection={handleToggleSection}
              selectionActionBar={selectionActionBar}
            />
          ) : (
            <SplitDiffTable
              diffResult={diffResult}
              language={language}
              languageReady={languageReady}
              selectedLines={selectedLines}
              onToggleLine={onToggleLine}
              onDragCommit={onDragCommit}
              blockIdPrefix={`cb-${blockId}`}
              fullHunks={fullHunks ?? undefined}
              expandedSections={expandedSections}
              onToggleSection={handleToggleSection}
              selectionActionBar={selectionActionBar}
            />
          )
        ) : (
          <div className="text-text-muted text-[var(--font-size)] py-4 text-center">No changes</div>
        )}
      </DiffFileCard>
    );
  },
);
FileDiffSection.displayName = 'FileDiffSection';

export default FileDiffSection;

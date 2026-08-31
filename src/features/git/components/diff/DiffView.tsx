import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { openProjectFile } from '@/features/quick-open';
import { fileIconSrc } from '@/shared/utils/fileIcons';

import CombinedDiffView from './CombinedDiffView';
import DiffTable from './DiffTable';
import DiffToolbar from './DiffToolbar';
import { mergeSelection, splitFilePath } from './diffViewUtils';
import type { SelectionMode } from './diffViewUtils';
import { DiffFileCard } from './FileDiffSection';
import { detectLanguage, ensureLanguageRegistered } from './highlight';
import ReviewInstructionPopover from './ReviewInstructionPopover';
import SelectionActionBar from './SelectionActionBar';
import SplitDiffTable from './SplitDiffTable';
import type { DiffViewProps, ViewMode } from './types';
import { useDiffData } from './useDiffData';
import { useDiffReview } from './useDiffReview';

const DiffView: React.FC<DiffViewProps> = React.memo(
  ({
    projectId,
    diffSource,
    filePath,
    initialMode,
    combined,
    files,
    scrollToPath,
    onScrollToPathChange,
    commands,
  }) => {
    const [viewMode, setViewMode] = useState<ViewMode>(initialMode ?? 'unified');
    const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
    // 全文模式：collapse=false 拉取未折叠的完整 diff
    const [fullMode, setFullMode] = useState(false);
    // 单段展开：已展开的 Collapsed 占位行（key 与 selectedLines 一致，含 combined 前缀）
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

    const fileList = useMemo(() => files ?? [], [files]);

    const clearSelection = useCallback(() => {
      setSelectedLines(new Set());
    }, []);

    // 单文件模式：切换文件时重置选区与展开状态
    useEffect(() => {
      if (combined) return;
      setSelectedLines(new Set());
      setExpandedSections(new Set());
      setFullMode(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filePath, diffSource, combined]);

    const {
      diffResult,
      fullHunks,
      loadFullHunks,
      loading,
      error,
      loadDiff,
      currentBlockIndex,
      setCurrentBlockIndex,
      changeStats,
      totalChangeBlocks,
    } = useDiffData({
      projectId,
      diffSource,
      // Skip single-file fetch noise in combined mode (each section loads itself).
      filePath: combined ? '' : filePath,
      collapse: !fullMode,
      commands,
    });

    const {
      reviewPopover,
      setReviewPopover,
      selectedCount,
      handleReviewFull,
      submitSelectionReview,
      submitFullReview,
      reportDiffResult,
      clearHunksCache,
      selectedLinesForPath,
      lastSelectedPath,
    } = useDiffReview({
      projectId,
      combined,
      filePath,
      diffResult,
      fileList,
      selectedLines,
      clearSelection,
    });

    /** 选中块末尾的 inline 输入条（VSCode 风格，嵌在 diff 表格里随选中行滚动）。 */
    const selectionActionBar = useCallback(
      () => (
        <SelectionActionBar
          selectedCount={selectedCount}
          onSubmit={submitSelectionReview}
          onClose={clearSelection}
        />
      ),
      [selectedCount, submitSelectionReview, clearSelection],
    );

    // 弹层在 combined / single 分支各渲染一次（同一变量，只会有一处返回挂载）。
    const reviewPopoverEl = reviewPopover ? (
      <ReviewInstructionPopover
        open
        onSubmit={submitFullReview}
        onClose={() => setReviewPopover(false)}
      />
    ) : null;

    const language = useMemo(() => detectLanguage(filePath), [filePath]);
    const singleParts = useMemo(() => splitFilePath(filePath), [filePath]);
    const [singleLanguageReady, setSingleLanguageReady] = useState(false);

    useEffect(() => {
      if (combined) return;
      let cancelled = false;
      void ensureLanguageRegistered(language).then(() => {
        if (!cancelled) setSingleLanguageReady(true);
      });
      return () => {
        cancelled = true;
      };
    }, [combined, language]);

    // Reset shared state when the commit file set identity changes.
    // （导航 state 由 CombinedDiffView 内部 useCombinedDiffNav 的 filesKey effect 负责。）
    const filesKey = useMemo(
      () => (combined ? fileList.map((f) => f.path).join('\0') : ''),
      [combined, fileList],
    );
    useEffect(() => {
      if (!combined) return;
      clearHunksCache();
      setSelectedLines(new Set());
      setExpandedSections(new Set());
      setFullMode(false);
      // Only when the file set changes — not on every scrollToPath (handled below).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filesKey, combined]);

    /** Single-file keys: `hunk:line`. Combined keys: `path\0hunk:line`. */
    const toggleLine = useCallback(
      (hunkIdx: number, lineIdx: number, path?: string) => {
        const prefix = path ? `${path}\0` : '';
        setSelectedLines((prev) => {
          const next = new Set(prev);
          if (lineIdx === -1) {
            // Hunk toggle only available in single-file mode where diffResult is known.
            const allLines = !path ? diffResult?.hunks[hunkIdx]?.lines : undefined;
            if (!allLines) return prev;
            const allIn = allLines.every((_, i) => next.has(`${prefix}${hunkIdx}:${i}`));
            if (allIn) {
              allLines.forEach((_, i) => next.delete(`${prefix}${hunkIdx}:${i}`));
            } else {
              allLines.forEach((_, i) => next.add(`${prefix}${hunkIdx}:${i}`));
            }
          } else {
            const key = `${prefix}${hunkIdx}:${lineIdx}`;
            if (next.has(key)) next.delete(key);
            else next.add(key);
          }
          return next;
        });
      },
      [diffResult],
    );

    /** 拖拽选区提交：replace=替换、append=追加（Shift）。 */
    const commitDragRange = useCallback((keys: Set<string>, mode: SelectionMode, path?: string) => {
      const prefix = path ? `${path}\0` : '';
      const prefixed = new Set<string>();
      for (const key of keys) {
        prefixed.add(`${prefix}${key}`);
      }
      setSelectedLines((prev) => mergeSelection(prev, prefixed, mode));
    }, []);

    /** 单段展开/收起：仅在真正展开时按需加载全量 hunks（收起无需全量）。 */
    const toggleSection = useCallback(
      (hunkIdx: number, lineIdx: number, path?: string) => {
        const key = path ? `${path}\0${hunkIdx}:${lineIdx}` : `${hunkIdx}:${lineIdx}`;
        const expanding = !expandedSections.has(key);
        setExpandedSections((prev) => {
          const next = new Set(prev);
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.add(key);
          }
          return next;
        });
        if (expanding) void loadFullHunks();
      },
      [expandedSections, loadFullHunks],
    );

    /** 切换全文模式（工具栏「展开全文 / 收起全文」）。 */
    const toggleFullMode = useCallback(() => {
      setFullMode((prev) => !prev);
      setExpandedSections(new Set());
    }, []);

    /** 切换视图模式时清空选区与展开态（unified/split 的 key 语义不同，防错位）。 */
    const handleViewModeChange = useCallback((mode: ViewMode) => {
      setViewMode(mode);
      setSelectedLines(new Set());
      setExpandedSections(new Set());
    }, []);

    /** combined 模式下某文件的已展开折叠段（key 去掉文件前缀）。 */
    const expandedSectionsForPath = useCallback(
      (path: string) => {
        const prefix = `${path}\0`;
        const out = new Set<string>();
        for (const key of expandedSections) {
          if (key.startsWith(prefix)) out.add(key.slice(prefix.length));
        }
        return out;
      },
      [expandedSections],
    );

    /** Single-file 变更块导航（combined 由 CombinedDiffView 内部 navigateCombinedBlock 处理）。 */
    const navigateBlock = useCallback(
      (direction: 'prev' | 'next') => {
        if (totalChangeBlocks === 0) return;
        let newIndex = currentBlockIndex;
        if (direction === 'prev' && currentBlockIndex > 0) {
          newIndex = currentBlockIndex - 1;
        } else if (direction === 'next' && currentBlockIndex < totalChangeBlocks - 1) {
          newIndex = currentBlockIndex + 1;
        } else {
          return;
        }
        setCurrentBlockIndex(newIndex);
        requestAnimationFrame(() => {
          const el = document.getElementById(`cb-${newIndex}`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      },
      [totalChangeBlocks, currentBlockIndex, setCurrentBlockIndex],
    );

    // ── Combined multi-file view ──────────────────────────────────────────
    if (combined && files && diffSource) {
      return (
        <CombinedDiffView
          projectId={projectId}
          diffSource={diffSource}
          fileList={fileList}
          initialPath={filePath}
          viewMode={viewMode}
          fullMode={fullMode}
          onViewModeChange={handleViewModeChange}
          onToggleFull={toggleFullMode}
          scrollToPath={scrollToPath}
          onScrollToPathChange={onScrollToPathChange}
          onReview={handleReviewFull}
          selectedLinesForPath={selectedLinesForPath}
          onToggleLine={toggleLine}
          onDragCommit={commitDragRange}
          expandedSectionsForPath={expandedSectionsForPath}
          onToggleSection={toggleSection}
          onDiffResult={reportDiffResult}
          lastSelectedPath={lastSelectedPath}
          selectionActionBar={selectionActionBar}
          reviewPopoverEl={reviewPopoverEl}
        />
      );
    }

    // ── Single-file: same card chrome as combined ─────────────────────────
    const singleToolbar = (
      <DiffToolbar
        title={singleParts.name}
        subtitle={singleParts.dir || undefined}
        titleTooltip={filePath}
        iconSrc={fileIconSrc(singleParts.name)}
        additions={loading || error ? 0 : changeStats.additions}
        deletions={loading || error ? 0 : changeStats.deletions}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        changeIndex={!loading && !error && totalChangeBlocks > 0 ? currentBlockIndex : 0}
        changeTotal={!loading && !error ? totalChangeBlocks : 0}
        onChangePrev={() => navigateBlock('prev')}
        onChangeNext={() => navigateBlock('next')}
        fullMode={fullMode}
        onToggleFull={toggleFullMode}
        onReview={loading || error ? undefined : handleReviewFull}
        onOpenFile={projectId ? () => void openProjectFile({ projectId, filePath }) : undefined}
        openFileDisabled={Boolean(loading || error)}
      />
    );

    let singleBody: React.ReactNode;
    if (loading) {
      singleBody = (
        <div className="space-y-2 py-2" aria-busy="true" aria-label="Loading diff">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-3 rounded bg-bg-tertiary/70 animate-pulse"
              style={{ width: `${70 + (i % 3) * 10}%` }}
            />
          ))}
        </div>
      );
    } else if (error) {
      singleBody = (
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-[var(--font-size)]">
          <p className="text-accent-red">Error: {error}</p>
          <button
            type="button"
            className="py-1.5 px-3 rounded bg-accent-blue/15 text-accent-blue border border-accent-blue/30 cursor-pointer hover:bg-accent-blue/25"
            onClick={() => {
              void loadDiff();
            }}
          >
            Retry
          </button>
        </div>
      );
    } else if (diffResult && diffResult.hunks.length > 0) {
      singleBody =
        viewMode === 'unified' ? (
          <DiffTable
            diffResult={diffResult}
            language={language}
            languageReady={singleLanguageReady}
            selectedLines={selectedLines}
            onToggleLine={toggleLine}
            onDragCommit={(keys, mode) => commitDragRange(keys, mode)}
            fullHunks={fullHunks ?? undefined}
            expandedSections={expandedSections}
            onToggleSection={(hunkIdx, lineIdx) => toggleSection(hunkIdx, lineIdx)}
            selectionActionBar={selectionActionBar}
          />
        ) : (
          <SplitDiffTable
            diffResult={diffResult}
            language={language}
            languageReady={singleLanguageReady}
            selectedLines={selectedLines}
            onToggleLine={toggleLine}
            onDragCommit={(keys, mode) => commitDragRange(keys, mode)}
            fullHunks={fullHunks ?? undefined}
            expandedSections={expandedSections}
            onToggleSection={(hunkIdx, lineIdx) => toggleSection(hunkIdx, lineIdx)}
            selectionActionBar={selectionActionBar}
          />
        );
    } else {
      singleBody = (
        <div className="text-text-muted text-[var(--font-size)] py-8 text-center">
          No changes to display
        </div>
      );
    }

    return (
      <div className="relative flex-1 flex flex-col overflow-hidden min-w-0 bg-bg-secondary">
        {singleToolbar}

        {reviewPopoverEl}

        <div className="flex-1 overflow-auto min-w-0 bg-bg-secondary py-0.5">
          {/*
            Single mode: keep the rounded content card for visual parity with
            combined, but hide the file header — toolbar already shows name/dir/stats.
          */}
          <DiffFileCard filePath={filePath} expanded active showHeader={false}>
            {singleBody}
          </DiffFileCard>
        </div>
      </div>
    );
  },
);
DiffView.displayName = 'DiffView';

export default DiffView;

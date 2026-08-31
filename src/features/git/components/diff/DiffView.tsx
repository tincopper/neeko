import React, { useCallback, useEffect, useMemo, useState } from 'react';

import CombinedDiffView from './CombinedDiffView';
import { mergeSelection } from './diffViewUtils';
import type { SelectionMode } from './diffViewUtils';
import ReviewInstructionPopover from './ReviewInstructionPopover';
import SelectionActionBar from './SelectionActionBar';
import SingleDiffBody from './SingleDiffBody';
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

    // ── Single-file: rendering delegated to SingleDiffBody ──────────────
    return (
      <SingleDiffBody
        filePath={filePath}
        projectId={projectId}
        loading={loading}
        error={error}
        diffResult={diffResult}
        viewMode={viewMode}
        fullMode={fullMode}
        onToggleFull={toggleFullMode}
        onViewModeChange={handleViewModeChange}
        changeStats={changeStats}
        totalChangeBlocks={totalChangeBlocks}
        currentBlockIndex={currentBlockIndex}
        onChangePrev={() => navigateBlock('prev')}
        onChangeNext={() => navigateBlock('next')}
        onRetry={() => void loadDiff()}
        onReview={handleReviewFull}
        selectedLines={selectedLines}
        onToggleLine={toggleLine}
        onDragCommit={commitDragRange}
        fullHunks={fullHunks}
        expandedSections={expandedSections}
        onToggleSection={toggleSection}
        selectionActionBar={selectionActionBar}
        reviewPopoverEl={reviewPopoverEl}
      />
    );
  },
);
DiffView.displayName = 'DiffView';

export default DiffView;

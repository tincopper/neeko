import React, { type ReactNode } from 'react';

import { openProjectFile } from '@/features/quick-open';
import { fileIconSrc } from '@/shared/utils/fileIcons';

import DiffTable from './DiffTable';
import DiffToolbar from './DiffToolbar';
import type { SelectionMode } from './diffViewUtils';
import { DiffFileCard } from './FileDiffSection';
import { detectLanguage, ensureLanguageRegistered } from './highlight';
import SplitDiffTable from './SplitDiffTable';
import type { DiffResult, ViewMode } from './types';

/** Loading 骨架（8 条脉冲占位条）。 */
function DiffLoadingSkeleton() {
  return (
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
}

/** Error 占位（错误文案 + Retry）。 */
function DiffErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-[var(--font-size)]">
      <p className="text-accent-red">Error: {error}</p>
      <button
        type="button"
        className="py-1.5 px-3 rounded bg-accent-blue/15 text-accent-blue border border-accent-blue/30 cursor-pointer hover:bg-accent-blue/25"
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}

/** Empty 占位。 */
function DiffEmptyState() {
  return (
    <div className="text-text-muted text-[var(--font-size)] py-8 text-center">
      No changes to display
    </div>
  );
}

interface SingleDiffBodyProps {
  filePath: string;
  projectId?: string;
  loading: boolean;
  error: string | null;
  diffResult: DiffResult | null;
  viewMode: ViewMode;
  fullMode: boolean;
  onToggleFull: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  changeStats: { additions: number; deletions: number };
  totalChangeBlocks: number;
  currentBlockIndex: number;
  onChangePrev: () => void;
  onChangeNext: () => void;
  onRetry: () => void;
  onReview?: () => void;
  selectedLines: Set<string>;
  onToggleLine: (blockIdx: number, lineIdx: number) => void;
  onDragCommit: (keys: Set<string>, mode: SelectionMode) => void;
  fullHunks: DiffResult['hunks'] | null | undefined;
  expandedSections: Set<string>;
  onToggleSection: (hunkIdx: number, lineIdx: number) => void;
  selectionActionBar?: () => ReactNode;
  reviewPopoverEl: React.ReactNode;
}

/**
 * Single-file diff 渲染分支：工具栏装配 + loading/error/empty/表格四态 body。
 * 从 DiffView 抽出，使 DiffView 退化为「single/combined 模式选择器」。
 */
function SingleDiffBody(props: SingleDiffBodyProps) {
  const {
    filePath,
    projectId,
    loading,
    error,
    diffResult,
    viewMode,
    fullMode,
    onToggleFull,
    onViewModeChange,
    changeStats,
    totalChangeBlocks,
    currentBlockIndex,
    onChangePrev,
    onChangeNext,
    onRetry,
    onReview,
    selectedLines,
    onToggleLine,
    onDragCommit,
    fullHunks,
    expandedSections,
    onToggleSection,
    selectionActionBar,
    reviewPopoverEl,
  } = props;

  const language = React.useMemo(() => detectLanguage(filePath), [filePath]);
  const [languageReady, setLanguageReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void ensureLanguageRegistered(filePath).then(() => {
      if (!cancelled) setLanguageReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const parts = filePath.split('/');
  const name = parts[parts.length - 1];
  const dir = parts.slice(0, -1).join('/');

  const singleToolbar = (
    <DiffToolbar
      title={name}
      subtitle={dir || undefined}
      titleTooltip={filePath}
      iconSrc={fileIconSrc(name)}
      additions={loading || error ? 0 : changeStats.additions}
      deletions={loading || error ? 0 : changeStats.deletions}
      viewMode={viewMode}
      onViewModeChange={onViewModeChange}
      changeIndex={!loading && !error && totalChangeBlocks > 0 ? currentBlockIndex : 0}
      changeTotal={!loading && !error ? totalChangeBlocks : 0}
      onChangePrev={onChangePrev}
      onChangeNext={onChangeNext}
      fullMode={fullMode}
      onToggleFull={onToggleFull}
      onReview={loading || error ? undefined : onReview}
      onOpenFile={projectId ? () => void openProjectFile({ projectId, filePath }) : undefined}
      openFileDisabled={Boolean(loading || error)}
    />
  );

  let body: React.ReactNode;
  if (loading) {
    body = <DiffLoadingSkeleton />;
  } else if (error) {
    body = <DiffErrorState error={error} onRetry={onRetry} />;
  } else if (diffResult && diffResult.hunks.length > 0) {
    body =
      viewMode === 'unified' ? (
        <DiffTable
          diffResult={diffResult}
          language={language}
          languageReady={languageReady}
          selectedLines={selectedLines}
          onToggleLine={onToggleLine}
          onDragCommit={(keys, mode) => onDragCommit(keys, mode)}
          fullHunks={fullHunks ?? undefined}
          expandedSections={expandedSections}
          onToggleSection={onToggleSection}
          selectionActionBar={selectionActionBar}
        />
      ) : (
        <SplitDiffTable
          diffResult={diffResult}
          language={language}
          languageReady={languageReady}
          selectedLines={selectedLines}
          onToggleLine={onToggleLine}
          onDragCommit={(keys, mode) => onDragCommit(keys, mode)}
          fullHunks={fullHunks ?? undefined}
          expandedSections={expandedSections}
          onToggleSection={onToggleSection}
          selectionActionBar={selectionActionBar}
        />
      );
  } else {
    body = <DiffEmptyState />;
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
          {body}
        </DiffFileCard>
      </div>
    </div>
  );
}

export default React.memo(SingleDiffBody);

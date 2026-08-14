import React from 'react';

import type { CommitFileChange } from '@/shared/types';

import DiffToolbar from './DiffToolbar';
import type { SelectionMode } from './diffViewUtils';
import FileDiffSection from './FileDiffSection';
import type { DiffHunk, DiffViewProps, ViewMode } from './types';
import { useCombinedDiffNav } from './useCombinedDiffNav';

interface CombinedDiffViewProps {
  projectId?: string;
  diffSource: NonNullable<DiffViewProps['diffSource']>;
  fileList: CommitFileChange[];
  /** 初始展开基准（= DiffView 的 filePath）。 */
  initialPath: string;
  viewMode: ViewMode;
  fullMode: boolean;
  onViewModeChange: (mode: ViewMode) => void;
  onToggleFull: () => void;
  /** Git Log 跳转目标路径（触发展开 + 滚动）。 */
  scrollToPath?: string;
  onScrollToPathChange?: (path: string) => void;
  /** 全文 review：为空时工具栏不渲染 review 按钮。 */
  onReview?: () => void;
  selectedLinesForPath: (path: string) => Set<string>;
  onToggleLine: (hunkIdx: number, lineIdx: number, path?: string) => void;
  onDragCommit: (keys: Set<string>, mode: SelectionMode, path?: string) => void;
  expandedSectionsForPath: (path: string) => Set<string>;
  onToggleSection: (hunkIdx: number, lineIdx: number, path?: string) => void;
  onDiffResult: (filePath: string, hunks: DiffHunk[] | null) => void;
  /** 全局最后一个选中行所属文件（仅该文件渲染 inline 输入条）。 */
  lastSelectedPath: string | null;
  selectionActionBar: () => React.ReactNode;
  reviewPopoverEl: React.ReactNode;
}

/**
 * Combined（多文件 commit）视图：工具栏 + 文件区块列表 + review 弹层。
 *
 * 导航 state（expandedPaths / currentFileIdx / 变更块光标）经 useCombinedDiffNav
 * 内部持有（state colocation），父级 DiffView 无需透传导航 props；其余状态与
 * 回调仍由父级提供，保证组件可独立测试。
 */
const CombinedDiffView: React.FC<CombinedDiffViewProps> = React.memo(
  ({
    projectId,
    diffSource,
    fileList,
    initialPath,
    viewMode,
    fullMode,
    onViewModeChange,
    onToggleFull,
    scrollToPath,
    onScrollToPathChange,
    onReview,
    selectedLinesForPath,
    onToggleLine,
    onDragCommit,
    expandedSectionsForPath,
    onToggleSection,
    onDiffResult,
    lastSelectedPath,
    selectionActionBar,
    reviewPopoverEl,
  }) => {
    const {
      scrollRef,
      expandedPaths,
      currentFileIdx,
      combinedChangeIndex,
      combinedMountedTotal,
      combinedStats,
      allCollapsed,
      toggleFile,
      toggleFoldAll,
      navigateFile,
      navigateCombinedBlock,
    } = useCombinedDiffNav({
      fileList,
      scrollToPath,
      initialPath,
      onScrollToPathChange,
      viewMode,
    });

    const pid = projectId || '';
    const activePath = fileList[currentFileIdx]?.path;
    return (
      <div
        className="relative flex-1 flex flex-col overflow-hidden min-w-0 bg-bg-secondary"
        ref={scrollRef}
      >
        <DiffToolbar
          title={activePath || `${fileList.length} files`}
          titleTooltip={activePath || `${fileList.length} files`}
          additions={combinedStats.additions}
          deletions={combinedStats.deletions}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          changeIndex={combinedChangeIndex}
          changeTotal={combinedMountedTotal}
          onChangePrev={() => navigateCombinedBlock('prev')}
          onChangeNext={() => navigateCombinedBlock('next')}
          showFileNav
          fileIndex={currentFileIdx}
          fileTotal={fileList.length}
          onFilePrev={() => navigateFile('prev')}
          onFileNext={() => navigateFile('next')}
          showFoldToggle
          allCollapsed={allCollapsed}
          onToggleFoldAll={toggleFoldAll}
          fullMode={fullMode}
          onToggleFull={onToggleFull}
          onReview={fileList.length > 0 ? onReview : undefined}
        />

        <div className="flex-1 overflow-auto min-w-0 bg-bg-secondary py-0.5">
          {fileList.map((f, idx) => (
            <FileDiffSection
              key={f.path}
              projectId={pid}
              diffSource={diffSource}
              filePath={f.path}
              status={f.status}
              additions={f.additions}
              deletions={f.deletions}
              viewMode={viewMode}
              expanded={expandedPaths.has(f.path)}
              active={idx === currentFileIdx}
              onToggle={() => toggleFile(f.path)}
              selectedLines={selectedLinesForPath(f.path)}
              onToggleLine={(hunkIdx, lineIdx) => onToggleLine(hunkIdx, lineIdx, f.path)}
              collapse={!fullMode}
              onDragCommit={(keys, mode) => onDragCommit(keys, mode, f.path)}
              expandedSections={expandedSectionsForPath(f.path)}
              onToggleSection={(hunkIdx, lineIdx) => onToggleSection(hunkIdx, lineIdx, f.path)}
              onDiffResult={onDiffResult}
              // 仅在全局最后一个选中行所属文件渲染 inline 输入条，避免多文件选区出现多个输入条
              selectionActionBar={f.path === lastSelectedPath ? selectionActionBar : undefined}
            />
          ))}
        </div>

        {reviewPopoverEl}
      </div>
    );
  },
);
CombinedDiffView.displayName = 'CombinedDiffView';

export default CombinedDiffView;

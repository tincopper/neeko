import React from 'react';

import type { CommitFileChange } from '@/shared/types';

import DiffToolbar from './DiffToolbar';
import type { SelectionMode } from './diffViewUtils';
import FileDiffSection from './FileDiffSection';
import type { DiffHunk, DiffViewProps, ViewMode } from './types';

interface CombinedDiffViewProps {
  projectId?: string;
  diffSource: NonNullable<DiffViewProps['diffSource']>;
  fileList: CommitFileChange[];
  currentFileIdx: number;
  expandedPaths: Set<string>;
  combinedStats: { additions: number; deletions: number };
  viewMode: ViewMode;
  fullMode: boolean;
  allCollapsed?: boolean;
  changeNavIndex: number;
  changeNavTotal: number;
  /** 滚动容器 ref（由父级持有：combined 变更块导航 / 折叠同步共用）。 */
  scrollRef: React.RefObject<HTMLDivElement>;
  onNavigateBlock: (direction: 'prev' | 'next') => void;
  onNavigateFile: (direction: 'prev' | 'next') => void;
  onToggleFile: (path: string) => void;
  onToggleFoldAll: () => void;
  onToggleFull: () => void;
  onViewModeChange: (mode: ViewMode) => void;
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
 * 纯展示组件 —— 所有状态/回调由父级 DiffView 持有，仅负责布局与透传，
 * 使 DiffView 主体保持在 300 行量级并保证 combined 分支可独立测试。
 */
const CombinedDiffView: React.FC<CombinedDiffViewProps> = React.memo(
  ({
    projectId,
    diffSource,
    fileList,
    currentFileIdx,
    expandedPaths,
    combinedStats,
    viewMode,
    fullMode,
    allCollapsed,
    changeNavIndex,
    changeNavTotal,
    scrollRef,
    onNavigateBlock,
    onNavigateFile,
    onToggleFile,
    onToggleFoldAll,
    onToggleFull,
    onViewModeChange,
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
          changeIndex={changeNavIndex}
          changeTotal={changeNavTotal}
          onChangePrev={() => onNavigateBlock('prev')}
          onChangeNext={() => onNavigateBlock('next')}
          showFileNav
          fileIndex={currentFileIdx}
          fileTotal={fileList.length}
          onFilePrev={() => onNavigateFile('prev')}
          onFileNext={() => onNavigateFile('next')}
          showFoldToggle
          allCollapsed={allCollapsed}
          onToggleFoldAll={onToggleFoldAll}
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
              onToggle={() => onToggleFile(f.path)}
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

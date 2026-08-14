import React, { useCallback, useState } from 'react';

import { cn } from '@/lib/utils';
import type { AheadBehind, ConnectionContext } from '@/shared/types';
import type {
  ProjectView,
  ProjectCommands,
  ProjectCapabilities,
} from '@/shared/types/activeProject';

import { useGitHistoryDiffActions } from '../hooks/useGitHistoryDiffActions';
import { useGitHistorySelection } from '../hooks/useGitHistorySelection';
import { useGitLogKeyboardNav } from '../hooks/useGitLogKeyboardNav';
import { useOpenDiffTab } from '../hooks/useOpenDiffTab';
import { useOpenStashDiff } from '../hooks/useOpenStashDiff';
import { useSingletonDiff } from '../hooks/useSingletonDiff';
import { useStashList } from '../hooks/useStashList';

import GitCommitPanel from './GitCommitPanel';
import GitLogPanel from './gitlog/GitLogPanel';
import { useCommitDetail } from './gitlog/useCommitDetail';
import { useGitLog } from './gitlog/useGitLog';
import StashPanel from './StashPanel';

export type GitControlTab = 'changes' | 'history' | 'stash';

/**
 * Git Control 容器：owns 全部数据 hooks 与 tab/键盘状态。
 *
 * - 数据 hooks 内聚于此（feature 容器），wrapper 保持薄适配；
 * - 激活门控：History tab 可见才拉 commit log；面板可见才拉 stash（徽章计数）；
 * - 键盘导航（J/K/j/k/c）仅在 History tab 激活时注册；
 * - 子面板保持展示型（props 输入），便于独立测试。
 */
interface GitControlPanelProps {
  project: ProjectView;
  commands: ProjectCommands;
  capabilities: ProjectCapabilities;
  connectionContext: ConnectionContext | null;
  /** worktree 激活时使用 worktree 专属 tab key（diff tab / stash diff） */
  activeWorktreePath?: string | null;
  /** 面板在 dock 中是否可见（激活门控数据加载） */
  active: boolean;
  onRefreshGit: () => Promise<void>;
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  aheadBehind: AheadBehind | null;
  changedFileCount: number;
}

const GitControlPanel: React.FC<GitControlPanelProps> = ({
  project,
  commands,
  capabilities,
  connectionContext,
  activeWorktreePath,
  active,
  onRefreshGit,
  onShowToast,
  aheadBehind,
  changedFileCount,
}) => {
  const [tab, setTab] = useState<GitControlTab>('changes');

  // History 选区本地状态（纯 state + handleSelectCommit）
  const {
    selectedHash,
    selectedExpanded,
    searchQuery,
    combined,
    currentFileIdx,
    handleSelectCommit,
    setSearchQuery,
    setCombined,
    setCurrentFileIdx,
  } = useGitHistorySelection();

  // 激活门控：History tab 可见才拉 commit log；面板可见才拉 stash（供徽章计数）
  const { commits, loading, hasMore, loadMore, refresh, loadingMore } = useGitLog(
    commands,
    active && tab === 'history',
  );

  const {
    detail,
    files,
    loading: detailLoading,
    error: detailError,
  } = useCommitDetail(commands, selectedHash);

  const {
    stashes,
    loading: stashLoading,
    error: stashError,
    expandedSelector: stashExpandedSelector,
    expandedFiles: stashExpandedFiles,
    filesLoading: stashFilesLoading,
    filesError: stashFilesError,
    toggleExpand: toggleStash,
    actionLoading: stashActionLoading,
    applyStash,
    popStash,
  } = useStashList(commands, active);

  const { openFileInDiff, openCombined, pinFile, scrollToFile, refreshOpenDiff, hasSingleton } =
    useSingletonDiff(project?.id, selectedHash, files, connectionContext, activeWorktreePath);

  const openStashDiff = useOpenStashDiff(project?.id, activeWorktreePath, stashes);

  const openCommitDiffTab = useOpenDiffTab(connectionContext, activeWorktreePath, project?.id);

  // Changes 提交 / stash apply/pop 后：刷新 git info（wrapper） + 日志
  const handleRefreshAll = useCallback(async () => {
    await onRefreshGit();
    refresh();
  }, [onRefreshGit, refresh]);

  // Diff singleton 处理器（combined 切换 / 文件导航 / pin + 联动刷新）
  const { handleToggleCombined, handleOpenDiff, handlePinFile } = useGitHistoryDiffActions({
    selectedHash,
    files,
    combined,
    currentFileIdx,
    openFileInDiff,
    openCombined,
    pinFile,
    scrollToFile,
    refreshOpenDiff,
    hasSingleton,
    setCombined,
    setCurrentFileIdx,
  });

  // J/K/j/k/c 快捷键仅在 History tab 激活时生效
  useGitLogKeyboardNav({
    enabled: tab === 'history',
    commits,
    selectedHash,
    files,
    currentFileIdx,
    combined,
    onSelectCommit: handleSelectCommit,
    onOpenFileDiff: openFileInDiff,
    onToggleCombined: handleToggleCombined,
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Underline tabs — same pattern as Settings / Debug panel */}
      <div
        className="flex shrink-0 items-stretch border-b border-border/40"
        role="tablist"
        aria-label="Git Control tabs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'changes'}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 border-b-2 px-3 text-[calc(var(--font-size)-1px)] font-medium transition-colors duration-100',
            tab === 'changes'
              ? 'border-accent-blue text-text-primary'
              : 'border-transparent text-text-muted hover:text-text-primary',
          )}
          onClick={() => setTab('changes')}
        >
          Changes
          {changedFileCount > 0 ? (
            <span
              className={cn(
                'min-w-[1.1rem] rounded-full px-1 text-center text-[calc(var(--font-size)-3px)] leading-4 tabular-nums',
                tab === 'changes'
                  ? 'bg-accent-blue/15 text-accent-blue'
                  : 'bg-bg-tertiary text-text-muted',
              )}
            >
              {changedFileCount}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          className={cn(
            'inline-flex h-8 items-center border-b-2 px-3 text-[calc(var(--font-size)-1px)] font-medium transition-colors duration-100',
            tab === 'history'
              ? 'border-accent-blue text-text-primary'
              : 'border-transparent text-text-muted hover:text-text-primary',
          )}
          onClick={() => setTab('history')}
        >
          History
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'stash'}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 border-b-2 px-3 text-[calc(var(--font-size)-1px)] font-medium transition-colors duration-100',
            tab === 'stash'
              ? 'border-accent-blue text-text-primary'
              : 'border-transparent text-text-muted hover:text-text-primary',
          )}
          onClick={() => setTab('stash')}
        >
          Stash
          {stashes.length > 0 ? (
            <span
              className={cn(
                'min-w-[1.1rem] rounded-full px-1 text-center text-[calc(var(--font-size)-3px)] leading-4 tabular-nums',
                tab === 'stash'
                  ? 'bg-accent-blue/15 text-accent-blue'
                  : 'bg-bg-tertiary text-text-muted',
              )}
            >
              {stashes.length}
            </span>
          ) : null}
        </button>
      </div>

      {/* Keep both panels mounted so draft commit message / selection survive tab switches. */}
      <div className="min-h-0 flex-1">
        <div className={cn('h-full min-h-0', tab !== 'changes' && 'hidden')}>
          <GitCommitPanel
            project={project}
            commands={commands}
            capabilities={capabilities}
            onRefreshGit={handleRefreshAll}
            onSelectFile={openCommitDiffTab}
            onShowToast={onShowToast}
            aheadBehind={aheadBehind}
          />
        </div>
        <div className={cn('h-full min-h-0', tab !== 'history' && 'hidden')}>
          <GitLogPanel
            commits={commits}
            loading={loading}
            hasMore={hasMore}
            loadMore={loadMore}
            loadingMore={loadingMore}
            refresh={refresh}
            selectedHash={selectedHash}
            selectedExpanded={selectedExpanded}
            searchQuery={searchQuery}
            combined={combined}
            detail={detail}
            files={files}
            detailLoading={detailLoading}
            detailError={detailError}
            onSelectCommit={handleSelectCommit}
            onOpenDiff={handleOpenDiff}
            onPinFile={handlePinFile}
            onSearchChange={setSearchQuery}
            onRefresh={refresh}
            onToggleCombined={handleToggleCombined}
            focusedFileIndex={currentFileIdx}
          />
        </div>
        <div className={cn('h-full min-h-0', tab !== 'stash' && 'hidden')}>
          <StashPanel
            stashes={stashes}
            loading={stashLoading}
            error={stashError}
            expandedSelector={stashExpandedSelector}
            expandedFiles={stashExpandedFiles}
            filesLoading={stashFilesLoading}
            filesError={stashFilesError}
            onToggle={toggleStash}
            actionLoading={stashActionLoading}
            onApply={applyStash}
            onPop={popStash}
            onOpenStashDiff={openStashDiff}
            onShowToast={onShowToast}
            onRefreshGit={handleRefreshAll}
          />
        </div>
      </div>
    </div>
  );
};

export default React.memo(GitControlPanel);

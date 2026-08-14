import React from 'react';

import { cn } from '@/lib/utils';
import type {
  AheadBehind,
  CommitEntry,
  CommitDetail,
  CommitFileChange,
  StashActionResult,
  StashEntry,
} from '@/shared/types';
import type {
  ProjectView,
  ProjectCommands,
  ProjectCapabilities,
} from '@/shared/types/activeProject';

import GitCommitPanel from './GitCommitPanel';
import GitLogPanel from './gitlog/GitLogPanel';
import StashPanel from './StashPanel';

export type GitControlTab = 'changes' | 'history' | 'stash';

interface GitControlPanelProps {
  // Changes tab
  project: ProjectView;
  commands: ProjectCommands;
  capabilities: ProjectCapabilities;
  onRefreshGit: () => Promise<void>;
  onSelectFile?: (filePath: string) => void;
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  onOpenDialog?: (type: 'new-branch' | 'new-worktree', e: React.MouseEvent) => void;
  aheadBehind: AheadBehind | null;
  changedFileCount: number;
  // History tab
  commits: CommitEntry[];
  logLoading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  onRefreshLog: () => void;
  selectedHash: string | null;
  selectedExpanded: boolean;
  searchQuery: string;
  combined: boolean;
  detail: CommitDetail | null;
  logFiles: CommitFileChange[];
  detailLoading: boolean;
  detailError: string | null;
  onSelectCommit: (hash: string) => void;
  onOpenDiff: (filePath: string) => void;
  onPinFile: (filePath: string) => void;
  onSearchChange: (query: string) => void;
  onToggleCombined: (combined: boolean) => void;
  focusedFileIndex?: number;
  // Stash tab
  stashes: StashEntry[];
  stashLoading: boolean;
  stashError: string | null;
  stashExpandedSelector: string | null;
  stashExpandedFiles: CommitFileChange[];
  stashFilesLoading: boolean;
  stashFilesError: string | null;
  onToggleStash: (selector: string) => void;
  actionLoading: boolean;
  onApply: (selector: string) => Promise<StashActionResult | null>;
  onPop: (selector: string) => Promise<StashActionResult | null>;
  onOpenStashDiff: (selector: string, filePath: string) => void;
  // Tab state (lifted for keyboard gating in wrapper)
  activeTab: GitControlTab;
  onTabChange: (tab: GitControlTab) => void;
}

const GitControlPanel: React.FC<GitControlPanelProps> = ({
  project,
  commands,
  capabilities,
  onRefreshGit,
  onSelectFile,
  onShowToast,
  onOpenDialog,
  aheadBehind,
  changedFileCount,
  commits,
  logLoading,
  hasMore,
  loadMore,
  loadingMore,
  onRefreshLog,
  selectedHash,
  selectedExpanded,
  searchQuery,
  combined,
  detail,
  logFiles,
  detailLoading,
  detailError,
  onSelectCommit,
  onOpenDiff,
  onPinFile,
  onSearchChange,
  onToggleCombined,
  focusedFileIndex,
  stashes,
  stashLoading,
  stashError,
  stashExpandedSelector,
  stashExpandedFiles,
  stashFilesLoading,
  stashFilesError,
  onToggleStash,
  actionLoading,
  onApply,
  onPop,
  onOpenStashDiff,
  activeTab,
  onTabChange,
}) => {
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
          aria-selected={activeTab === 'changes'}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 border-b-2 px-3 text-[calc(var(--font-size)-1px)] font-medium transition-colors duration-100',
            activeTab === 'changes'
              ? 'border-accent-blue text-text-primary'
              : 'border-transparent text-text-muted hover:text-text-primary',
          )}
          onClick={() => onTabChange('changes')}
        >
          Changes
          {changedFileCount > 0 ? (
            <span
              className={cn(
                'min-w-[1.1rem] rounded-full px-1 text-center text-[calc(var(--font-size)-3px)] leading-4 tabular-nums',
                activeTab === 'changes'
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
          aria-selected={activeTab === 'history'}
          className={cn(
            'inline-flex h-8 items-center border-b-2 px-3 text-[calc(var(--font-size)-1px)] font-medium transition-colors duration-100',
            activeTab === 'history'
              ? 'border-accent-blue text-text-primary'
              : 'border-transparent text-text-muted hover:text-text-primary',
          )}
          onClick={() => onTabChange('history')}
        >
          History
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'stash'}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 border-b-2 px-3 text-[calc(var(--font-size)-1px)] font-medium transition-colors duration-100',
            activeTab === 'stash'
              ? 'border-accent-blue text-text-primary'
              : 'border-transparent text-text-muted hover:text-text-primary',
          )}
          onClick={() => onTabChange('stash')}
        >
          Stash
          {stashes.length > 0 ? (
            <span
              className={cn(
                'min-w-[1.1rem] rounded-full px-1 text-center text-[calc(var(--font-size)-3px)] leading-4 tabular-nums',
                activeTab === 'stash'
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
        <div className={cn('h-full min-h-0', activeTab !== 'changes' && 'hidden')}>
          <GitCommitPanel
            project={project}
            commands={commands}
            capabilities={capabilities}
            onRefreshGit={onRefreshGit}
            onSelectFile={onSelectFile}
            onShowToast={onShowToast}
            onOpenDialog={onOpenDialog}
            aheadBehind={aheadBehind}
          />
        </div>
        <div className={cn('h-full min-h-0', activeTab !== 'history' && 'hidden')}>
          <GitLogPanel
            commits={commits}
            loading={logLoading}
            hasMore={hasMore}
            loadMore={loadMore}
            loadingMore={loadingMore}
            refresh={onRefreshLog}
            selectedHash={selectedHash}
            selectedExpanded={selectedExpanded}
            searchQuery={searchQuery}
            combined={combined}
            detail={detail}
            files={logFiles}
            detailLoading={detailLoading}
            detailError={detailError}
            onSelectCommit={onSelectCommit}
            onOpenDiff={onOpenDiff}
            onPinFile={onPinFile}
            onSearchChange={onSearchChange}
            onRefresh={onRefreshLog}
            onToggleCombined={onToggleCombined}
            focusedFileIndex={focusedFileIndex}
          />
        </div>
        <div className={cn('h-full min-h-0', activeTab !== 'stash' && 'hidden')}>
          <StashPanel
            stashes={stashes}
            loading={stashLoading}
            error={stashError}
            expandedSelector={stashExpandedSelector}
            expandedFiles={stashExpandedFiles}
            filesLoading={stashFilesLoading}
            filesError={stashFilesError}
            onToggle={onToggleStash}
            actionLoading={actionLoading}
            onApply={onApply}
            onPop={onPop}
            onOpenStashDiff={onOpenStashDiff}
            onShowToast={onShowToast}
            onRefreshGit={onRefreshGit}
          />
        </div>
      </div>
    </div>
  );
};

export default React.memo(GitControlPanel);

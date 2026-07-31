import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useShallow } from 'zustand/shallow';

import {
  BranchIcon,
  GitBranch,
  ArrowDown,
  ArrowUp,
  RefreshCw,
  FolderGit2,
  CloudDownload,
} from '@/shared/components/icons';
import { useGitStore } from '@/shared/store/gitStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { GitInfo, AheadBehind } from '@/shared/types';
import { filterWorktreeBranches, isActiveWorktree } from '@/shared/utils';

import BranchSwitcherPanel from './BranchSwitcherPanel';

interface BranchInfoProps {
  gitInfo: GitInfo | null;
  projectId: string;
  aheadBehind: AheadBehind | null;
  loading: boolean;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onRefresh: () => void;
  onNewBranch: () => void;
  onNewWorktree: () => void;
  onCheckoutBranch: (branchName: string) => void;
}

const BranchInfo: React.FC<BranchInfoProps> = ({
  gitInfo,
  projectId,
  aheadBehind,
  loading,
  onFetch,
  onPull,
  onPush,
  onRefresh,
  onNewBranch,
  onNewWorktree,
  onCheckoutBranch,
}) => {
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const branchDropdownRef = useRef<HTMLDivElement>(null);

  const favoriteBranches = useGitStore(useShallow((s) => s.favoriteBranches[projectId] ?? []));
  const toggleFavorite = useGitStore((s) => s.toggleFavorite);

  // Worktree 绑定独立分支，不允许在 changes 面板切换分支（与 BranchStatusBarWidget 一致）
  const activeWorktreePath = useWorktreeStore((s) => s.activeWorktreePath);
  const activeWorktreeBranch = useWorktreeStore((s) => s.activeWorktreeBranch);
  const isWorktreeActive = isActiveWorktree(activeWorktreePath);

  const handleToggleBranchDropdown = useCallback(() => {
    if (isWorktreeActive) return;
    setBranchDropdownOpen((v) => !v);
  }, [isWorktreeActive]);

  // Close on outside click
  useEffect(() => {
    if (!branchDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setBranchDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [branchDropdownOpen]);

  const currentBranch = gitInfo?.current_branch ?? '';
  // worktree 激活时显示 worktree 分支名，而非主分支的 current_branch
  const displayBranch = isWorktreeActive ? activeWorktreeBranch : currentBranch;
  const branches = useMemo(() => gitInfo?.branches ?? [], [gitInfo?.branches]);
  const worktrees = useMemo(() => gitInfo?.worktrees ?? [], [gitInfo?.worktrees]);
  // Exclude branches that are already checked out in a worktree
  const availableBranches = useMemo(
    () => filterWorktreeBranches(branches, worktrees),
    [worktrees, branches],
  );

  const aheadBehindMap = useMemo(() => {
    if (!aheadBehind || !displayBranch) return {};
    return { [displayBranch]: { ahead: aheadBehind.ahead, behind: aheadBehind.behind } };
  }, [aheadBehind, displayBranch]);

  const handleCheckout = (branchName: string) => {
    onCheckoutBranch(branchName);
  };

  const handleClose = () => setBranchDropdownOpen(false);

  const handleToggleFavorite = useCallback(
    (branchName: string) => {
      toggleFavorite(projectId, branchName);
    },
    [projectId, toggleFavorite],
  );

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-bg-tertiary/50 rounded-md">
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {gitInfo ? (
          <div
            className="relative min-w-0"
            ref={branchDropdownRef}
            role="none"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setBranchDropdownOpen(false);
              }
            }}
          >
            {/* Trigger: styled pill badge */}
            <span
              role="button"
              tabIndex={0}
              className={`flex items-center gap-1 text-[var(--font-size)] text-accent-blue font-mono bg-accent-blue/10 border border-accent-blue/20 rounded-full px-2 py-0.5 truncate cursor-pointer transition-colors duration-150 hover:bg-accent-blue/20 hover:border-accent-blue/40 ${
                isWorktreeActive ? 'opacity-70 cursor-default' : ''
              }`}
              title={
                isWorktreeActive ? `Worktree branch: ${displayBranch} (read-only)` : displayBranch
              }
              onClick={handleToggleBranchDropdown}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleToggleBranchDropdown();
                }
              }}
            >
              <BranchIcon size={11} />
              {displayBranch}
            </span>

            {/* Panel */}
            {branchDropdownOpen && (
              <div className="absolute top-[calc(100%+4px)] left-0 z-[1000]">
                <BranchSwitcherPanel
                  branches={availableBranches}
                  currentBranch={currentBranch}
                  favoriteBranches={favoriteBranches}
                  aheadBehind={aheadBehindMap}
                  onCheckout={handleCheckout}
                  onToggleFavorite={handleToggleFavorite}
                  onNewBranch={() => {
                    setBranchDropdownOpen(false);
                    onNewBranch();
                  }}
                  onNewWorktree={() => {
                    setBranchDropdownOpen(false);
                    onNewWorktree();
                  }}
                  onClose={handleClose}
                />
              </div>
            )}
          </div>
        ) : (
          <span className="text-[var(--font-size)] text-text-muted italic">Not a git repo</span>
        )}

        {aheadBehind && (aheadBehind.ahead > 0 || aheadBehind.behind > 0) && (
          <span className="flex items-center gap-1 text-[calc(var(--font-size)-1px)] text-text-muted ml-0.5">
            {aheadBehind.behind > 0 && (
              <span
                className="flex items-center gap-0.5 text-accent-blue"
                title={`${aheadBehind.behind} commits behind`}
              >
                <ArrowDown size={10} />
                {aheadBehind.behind}
              </span>
            )}
            {aheadBehind.ahead > 0 && (
              <span
                className="flex items-center gap-0.5 text-accent-green"
                title={`${aheadBehind.ahead} commits ahead`}
              >
                <ArrowUp size={10} />
                {aheadBehind.ahead}
              </span>
            )}
          </span>
        )}
      </div>

      <div className="flex items-center gap-0.5 shrink-0 bg-bg-tertiary rounded-md p-0.5">
        <button
          className="p-1 rounded text-text-muted hover:text-accent-blue hover:bg-bg-hover transition-colors duration-100"
          title="Fetch"
          onClick={onFetch}
          disabled={loading}
        >
          <CloudDownload size={13} />
        </button>
        <button
          className="p-1 rounded text-text-muted hover:text-accent-blue hover:bg-bg-hover transition-colors duration-100"
          title="Pull"
          onClick={onPull}
          disabled={loading}
        >
          <ArrowDown size={13} />
        </button>
        <button
          className="p-1 rounded text-text-muted hover:text-accent-blue hover:bg-bg-hover transition-colors duration-100"
          title="Push"
          onClick={onPush}
          disabled={loading}
        >
          <ArrowUp size={13} />
        </button>
      </div>

      <div className="flex items-center gap-0.5 shrink-0 bg-bg-tertiary rounded-md p-0.5">
        <button
          className="p-1 rounded text-text-muted hover:text-accent-blue hover:bg-bg-hover transition-colors duration-100"
          title="New Branch"
          onClick={onNewBranch}
        >
          <GitBranch size={13} />
        </button>
        <button
          className="p-1 rounded text-text-muted hover:text-accent-blue hover:bg-bg-hover transition-colors duration-100"
          title="New Worktree"
          onClick={onNewWorktree}
        >
          <FolderGit2 size={13} />
        </button>
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        <button
          className="p-1 rounded text-text-muted hover:text-accent-blue hover:bg-bg-hover transition-colors duration-100"
          title="Refresh"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
  );
};

export default React.memo(BranchInfo);

import React, { useState, useRef, useEffect, useMemo } from "react";
import type { GitInfo, AheadBehind } from "../../types";
import { BranchIcon, PlusIcon } from "../icons";
import { GitBranch, ArrowDown, ArrowUp, RefreshCw, FolderGit2 } from "lucide-react";
import BranchDropdownContent from "../shared/BranchDropdownContent";

interface BranchInfoProps {
  gitInfo: GitInfo | null;
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

  // Close on outside click
  useEffect(() => {
    if (!branchDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setBranchDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [branchDropdownOpen]);

  const currentBranch = gitInfo?.current_branch ?? "";
  const branches = gitInfo?.branches ?? [];
  const worktrees = gitInfo?.worktrees ?? [];

  // Exclude branches that are already checked out in a worktree
  const availableBranches = useMemo(() => {
    const worktreeBranchSet = new Set(worktrees.map((wt) => wt.branch));
    return branches.filter((b) => !worktreeBranchSet.has(b));
  }, [worktrees, branches]);

  const handleCheckout = (branchName: string) => {
    onCheckoutBranch(branchName);
  };

  const handleClose = () => setBranchDropdownOpen(false);

  // Footer: "New Branch" action injected via composition
  const dropdownFooter = (
    <div
      className="flex items-center gap-1.5 py-1 px-3 text-[var(--font-size)] text-text-secondary cursor-pointer transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary"
      onClick={() => {
        setBranchDropdownOpen(false);
        onNewBranch();
      }}
    >
      <PlusIcon size={11} />
      New Branch
    </div>
  );

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-bg-tertiary/50 rounded-md">
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {gitInfo ? (
          <div className="relative min-w-0" ref={branchDropdownRef}>
            {/* Trigger: styled pill badge */}
            <span
              className="flex items-center gap-1 text-[var(--font-size)] text-accent-blue font-mono bg-accent-blue/10 border border-accent-blue/20 rounded-full px-2 py-0.5 truncate cursor-pointer transition-colors duration-150 hover:bg-accent-blue/20 hover:border-accent-blue/40"
              title={currentBranch}
              onClick={() => setBranchDropdownOpen((v) => !v)}
            >
              <BranchIcon size={11} />
              {currentBranch}
            </span>

            {/* Dropdown panel */}
            {branchDropdownOpen && (
              <div className="absolute top-[calc(100%+4px)] left-0 z-[1000]">
                <BranchDropdownContent
                  branches={availableBranches}
                  currentBranch={currentBranch}
                  onSelect={handleCheckout}
                  onClose={handleClose}
                  footer={dropdownFooter}
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
              <span className="flex items-center gap-0.5 text-accent-blue" title={`${aheadBehind.behind} commits behind`}>
                <ArrowDown size={10} />
                {aheadBehind.behind}
              </span>
            )}
            {aheadBehind.ahead > 0 && (
              <span className="flex items-center gap-0.5 text-accent-green" title={`${aheadBehind.ahead} commits ahead`}>
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
          <RefreshCw size={13} />
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
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
    </div>
  );
};

export default React.memo(BranchInfo);

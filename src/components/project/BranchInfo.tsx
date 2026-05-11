import React, { useState, useRef, useEffect, useMemo } from "react";
import type { GitInfo, AheadBehind } from "../../types";
import { BranchIcon, SearchIcon, PlusIcon } from "../icons";
import { GitBranch, ArrowDown, ArrowUp, RefreshCw, FolderGit2 } from "lucide-react";

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
  const [branchSearchQuery, setBranchSearchQuery] = useState("");
  const branchDropdownRef = useRef<HTMLDivElement>(null);
  const branchSearchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!branchDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setBranchDropdownOpen(false);
        setBranchSearchQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [branchDropdownOpen]);

  useEffect(() => {
    if (branchDropdownOpen && branchSearchInputRef.current) {
      branchSearchInputRef.current.focus();
    }
  }, [branchDropdownOpen]);

  const currentBranch = gitInfo?.current_branch ?? "";
  const branches = gitInfo?.branches ?? [];
  const worktrees = gitInfo?.worktrees ?? [];

  const filteredBranches = useMemo(() => {
    const worktreeBranchSet = new Set(worktrees.map((wt) => wt.branch));
    return branches.filter((b) => !worktreeBranchSet.has(b));
  }, [worktrees, branches]);

  const dropdownBranches = useMemo(() => {
    const q = branchSearchQuery.toLowerCase().trim();
    if (!q) return filteredBranches;
    return filteredBranches.filter((b) => b.toLowerCase().includes(q));
  }, [filteredBranches, branchSearchQuery]);

  const handleCheckout = (branchName: string) => {
    if (branchName === currentBranch) return;
    setBranchDropdownOpen(false);
    setBranchSearchQuery("");
    onCheckoutBranch(branchName);
  };

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-bg-tertiary/50 rounded-md">
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {gitInfo ? (
          <div className="relative min-w-0" ref={branchDropdownRef}>
            <span
              className="flex items-center gap-1 text-[var(--font-size)] text-accent-blue font-mono bg-accent-blue/10 border border-accent-blue/20 rounded-full px-2 py-0.5 truncate cursor-pointer transition-colors duration-150 hover:bg-accent-blue/20 hover:border-accent-blue/40"
              title={currentBranch}
              onClick={() => setBranchDropdownOpen((v) => !v)}
            >
              <BranchIcon size={11} />
              {currentBranch}
            </span>
            {branchDropdownOpen && (
              <div
                className="absolute top-[calc(100%+4px)] left-0 bg-bg-secondary border border-border rounded-lg min-w-[220px] max-w-[320px] z-[1000] shadow-xl overflow-hidden flex flex-col"
              >
                <div className="flex items-center gap-1.5 p-2 px-2.5 border-b border-border">
                  <SearchIcon size={12} className="text-text-muted shrink-0" />
                  <input
                    ref={branchSearchInputRef}
                    className="gh-branch-dropdown-search-input flex-1 bg-transparent border-none outline-none text-text-primary text-[var(--font-size)] font-inherit"
                    placeholder="Search branches..."
                    value={branchSearchQuery}
                    onChange={(e) => setBranchSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setBranchDropdownOpen(false);
                        setBranchSearchQuery("");
                      }
                    }}
                  />
                </div>
                <div className="max-h-[240px] overflow-y-auto py-1">
                  {dropdownBranches.map((branch) => {
                    const isCurrent = branch === currentBranch;
                    return (
                      <div
                        key={branch}
                        className={`flex items-center gap-1.5 py-1 px-3 text-[var(--font-size)] font-mono text-text-secondary cursor-pointer transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary ${isCurrent ? "!text-accent-blue cursor-default" : ""}`}
                        onClick={() => handleCheckout(branch)}
                        title={isCurrent ? "Current branch" : "Click to checkout"}
                      >
                        <BranchIcon size={11} />
                        <span className="flex-1 truncate">{branch}</span>
                        {isCurrent && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] shrink-0" title="current" />
                        )}
                      </div>
                    );
                  })}
                  {dropdownBranches.length === 0 && (
                    <div className="p-3 text-center text-[var(--font-size)] text-text-muted">No branches found</div>
                  )}
                </div>
                <div className="border-t border-border py-1">
                  <div
                    className="flex items-center gap-1.5 py-1 px-3 text-[var(--font-size)] text-text-secondary cursor-pointer transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary"
                    onClick={() => {
                      setBranchDropdownOpen(false);
                      setBranchSearchQuery("");
                      onNewBranch();
                    }}
                  >
                    <PlusIcon size={11} />
                    New Branch
                  </div>
                </div>
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

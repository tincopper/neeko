import React from "react";
import type { GitInfo, AheadBehind } from "../../types";
import { BranchIcon } from "../icons";
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
}) => {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {gitInfo ? (
          <span className="flex items-center gap-1 text-xs text-accent-blue font-mono bg-accent-blue/10 border border-accent-blue/20 rounded-full px-2 py-0.5 truncate">
            <BranchIcon size={11} />
            {gitInfo.current_branch}
          </span>
        ) : (
          <span className="text-xs text-text-muted italic">Not a git repo</span>
        )}

        {aheadBehind && (aheadBehind.ahead > 0 || aheadBehind.behind > 0) && (
          <span className="flex items-center gap-1 text-[11px] text-text-muted ml-0.5">
            {aheadBehind.behind > 0 && (
              <span className="flex items-center gap-0.5 text-accent-yellow" title={`${aheadBehind.behind} commits behind`}>
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

      <div className="flex items-center gap-0.5 shrink-0">
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

        <span className="w-px h-4 bg-border mx-0.5" />

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

        <span className="w-px h-4 bg-border mx-0.5" />

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

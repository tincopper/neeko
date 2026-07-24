import React from "react";
import type { CommitEntry, CommitDetail, CommitFileChange } from "@/features/git/types";
import LogToolbar from "./LogToolbar";
import CommitList from "./CommitList";

interface GitLogPanelProps {
  commits: CommitEntry[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  refresh: () => void;
  selectedHash: string | null;
  selectedExpanded: boolean;
  searchQuery: string;
  combined: boolean;
  detail: CommitDetail | null;
  files: CommitFileChange[];
  detailLoading: boolean;
  detailError: string | null;
  onSelectCommit: (hash: string) => void;
  onOpenDiff: (filePath: string) => void;
  onPinFile: (filePath: string) => void;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
  onToggleCombined: (combined: boolean) => void;
}

const GitLogPanel: React.FC<GitLogPanelProps> = ({
  commits,
  loading,
  hasMore,
  loadMore,
  loadingMore,
  selectedHash,
  selectedExpanded,
  searchQuery,
  combined,
  detail,
  files,
  detailLoading,
  detailError,
  onSelectCommit,
  onOpenDiff,
  onPinFile,
  onSearchChange,
  onRefresh,
  onToggleCombined,
}) => {
  return (
    <div className="flex flex-col h-full p-1 gap-0.5">
      <div className="flex items-center gap-1.5 shrink-0 px-1">
        <LogToolbar
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          onRefresh={onRefresh}
          loading={loading}
        />
        <label className="flex items-center gap-1 text-[calc(var(--font-size)-2px)] text-text-muted cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={combined}
            onChange={(e) => onToggleCombined(e.target.checked)}
            className="accent-accent-blue"
          />
          组合
        </label>
      </div>

      <div className="flex-1 min-h-0">
        <CommitList
          commits={commits}
          selectedHash={selectedHash}
          selectedExpanded={selectedExpanded}
          detail={detail}
          files={files}
          detailLoading={detailLoading}
          detailError={detailError}
          onSelectCommit={onSelectCommit}
          onOpenDiff={onOpenDiff}
          onPinFile={onPinFile}
          loading={loading}
          hasMore={hasMore}
          onLoadMore={loadMore}
          loadingMore={loadingMore}
          searchQuery={searchQuery}
        />
      </div>
    </div>
  );
};

export default React.memo(GitLogPanel);
import React from "react";
import { cn } from "@/lib/utils";
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
  /** Optional: index of file focused via j/k shortcuts */
  focusedFileIndex?: number;
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
  focusedFileIndex,
}) => {
  return (
    <div className="flex flex-col h-full p-1.5 gap-1">
      <div className="flex items-center gap-1.5 shrink-0">
        <LogToolbar
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          onRefresh={onRefresh}
          loading={loading}
        />
        <div
          className="flex items-center shrink-0 rounded-md border border-border/30 bg-bg-tertiary/40 p-0.5"
          role="group"
          aria-label="Diff view mode"
        >
          <button
            type="button"
            className={cn(
              "px-1.5 py-0.5 rounded text-[calc(var(--font-size)-2px)] font-medium transition-colors duration-150",
              !combined
                ? "bg-accent-blue/15 text-accent-blue"
                : "text-text-muted hover:text-text-secondary",
            )}
            onClick={() => onToggleCombined(false)}
            title="Single-file diff"
          >
            Single
          </button>
          <button
            type="button"
            className={cn(
              "px-1.5 py-0.5 rounded text-[calc(var(--font-size)-2px)] font-medium transition-colors duration-150",
              combined
                ? "bg-accent-blue/15 text-accent-blue"
                : "text-text-muted hover:text-text-secondary",
            )}
            onClick={() => onToggleCombined(true)}
            title="Combined multi-file diff"
          >
            All
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 rounded-md overflow-hidden">
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
          focusedFileIndex={focusedFileIndex}
          onClearSearch={() => onSearchChange("")}
        />
      </div>
    </div>
  );
};

export default React.memo(GitLogPanel);

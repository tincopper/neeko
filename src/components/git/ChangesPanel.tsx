import React, { useCallback, useMemo, useState } from "react";
import { GitBranch, Plus, RefreshCw } from "lucide-react";

interface FileItem {
  path: string;
  status: "Modified" | "Added" | "Deleted" | "Renamed" | "Untracked";
  additions: number;
  deletions: number;
}

interface ChangesPanelProps {
  changedFiles: FileItem[];
  unversionedFiles: FileItem[];
  selectedFiles: Set<string>;
  selectedFilePath: string | null;
  currentBranch: string;
  loading: boolean;
  onToggleFile: (path: string) => void;
  onToggleAll: () => void;
  onSelectFile: (path: string) => void;
  onCommit: (message: string, amend: boolean) => void;
  onCommitPush: (message: string, amend: boolean) => void;
  onRefresh: () => void;
}

const STATUS_MAP: Record<string, string> = {
  Modified: "M",
  Added: "A",
  Deleted: "D",
  Renamed: "R",
  Untracked: "U",
};

const STATUS_COLORS: Record<string, string> = {
  M: "text-[#e5c07b] bg-[rgba(229,192,123,0.15)]",
  A: "text-[#98c379] bg-[rgba(152,195,121,0.15)]",
  D: "text-[#e06c75] bg-[rgba(224,108,117,0.15)]",
  R: "text-[#c678dd] bg-[rgba(198,120,221,0.15)]",
  U: "text-[#5c6370] bg-[rgba(92,99,112,0.15)]",
};

function ChangesPanel({
  changedFiles,
  unversionedFiles,
  selectedFiles,
  selectedFilePath,
  currentBranch,
  loading,
  onToggleFile,
  onToggleAll,
  onSelectFile,
  onCommit,
  onCommitPush,
  onRefresh,
}: ChangesPanelProps) {
  const [commitMessage, setCommitMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [unversionedCollapsed, setUnversionedCollapsed] = useState(false);

  // Filter changed files
  const filteredChanged = useMemo(() => {
    if (activeFilter === "all") return changedFiles;
    return changedFiles.filter((f) => STATUS_MAP[f.status] === activeFilter);
  }, [changedFiles, activeFilter]);

  // All selectable file paths
  const allPaths = useMemo(() => {
    return [...changedFiles, ...unversionedFiles].map((f) => f.path);
  }, [changedFiles, unversionedFiles]);

  // Select all state
  const selectAllState = useMemo(() => {
    if (allPaths.length === 0) return "none";
    const selected = allPaths.filter((p) => selectedFiles.has(p));
    if (selected.length === allPaths.length) return "all";
    if (selected.length > 0) return "some";
    return "none";
  }, [allPaths, selectedFiles]);

  const handleCommit = useCallback(() => {
    onCommit(commitMessage, amend);
    setCommitMessage("");
  }, [commitMessage, amend, onCommit]);

  const handleCommitPush = useCallback(() => {
    onCommitPush(commitMessage, amend);
    setCommitMessage("");
  }, [commitMessage, amend, onCommitPush]);

  // Group files by directory
  const groupByDir = useCallback((files: FileItem[]) => {
    const groups: Record<string, FileItem[]> = {};
    for (const f of files) {
      const parts = f.path.split("/");
      const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
      if (!groups[dir]) groups[dir] = [];
      groups[dir].push(f);
    }
    return groups;
  }, []);

  const renderFileList = (files: FileItem[], showCheckbox: boolean) => {
    if (files.length === 0) {
      return (
        <div className="px-3 py-4 text-center text-text-muted text-[calc(var(--font-size)-1px)]">
          No changes
        </div>
      );
    }

    const groups = groupByDir(files);
    const dirs = Object.keys(groups).sort();

    return dirs.map((dir) => (
      <div key={dir}>
        {dir && (
          <div className="flex items-center gap-1 px-2 py-0.5 text-text-muted text-[calc(var(--font-size)-1px)]">
            <span className="text-[8px]">▼</span>
            <span className="text-text-secondary">{dir}/</span>
            <span className="text-[10px]">({groups[dir].length})</span>
          </div>
        )}
        {groups[dir].map((f) => {
          const shortStatus = STATUS_MAP[f.status] ?? "?";
          const colorClass = STATUS_COLORS[shortStatus] ?? "text-text-muted bg-bg-tertiary";
          const isSelected = f.path === selectedFilePath;
          const isChecked = selectedFiles.has(f.path);
          const fileName = f.path.split("/").pop() ?? f.path;

          return (
            <div
              key={f.path}
              className={`flex items-center gap-1.5 px-2 py-0.5 cursor-pointer transition-colors ${
                isSelected ? "bg-[rgba(97,175,239,0.12)]" : "hover:bg-bg-hover"
              }`}
              onClick={() => onSelectFile(f.path)}
            >
              {showCheckbox && (
                <div
                  className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                    isChecked
                      ? "bg-accent-blue border-accent-blue"
                      : "border-text-muted"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFile(f.path);
                  }}
                >
                  {isChecked && <span className="text-white text-[8px] font-bold">✓</span>}
                </div>
              )}
              <span className="flex-1 truncate text-[calc(var(--font-size))] text-text-primary">
                {fileName}
              </span>
              <span
                className={`inline-flex items-center justify-center w-[18px] h-4 rounded-[3px] text-[10px] font-bold shrink-0 ${colorClass}`}
                title={f.status}
              >
                {shortStatus}
              </span>
              {f.additions > 0 && (
                <span className="text-[10px] text-accent-green shrink-0">+{f.additions}</span>
              )}
              {f.deletions > 0 && (
                <span className="text-[10px] text-accent-red shrink-0">-{f.deletions}</span>
              )}
            </div>
          );
        })}
      </div>
    ));
  };

  const filterOptions = ["all", "M", "A", "D", "R", "U"];
  const filterLabels: Record<string, string> = {
    all: "All",
    M: "Modified",
    A: "Added",
    D: "Deleted",
    R: "Renamed",
    U: "Untracked",
  };

  return (
    <div className="flex flex-col h-full">
      {/* Branch info bar */}
      <div className="px-2.5 py-2 border-b border-border">
        <div className="flex items-center gap-1.5 mb-1.5">
          <GitBranch size={13} className="text-accent-green shrink-0" />
          <span className="text-[calc(var(--font-size)+1px)] font-semibold text-text-primary truncate">
            {currentBranch}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <button className="inline-flex items-center gap-1 px-2 py-0.5 border border-border rounded bg-bg-tertiary text-text-secondary text-[calc(var(--font-size)-1px)] hover:bg-bg-hover hover:text-text-primary hover:border-accent-blue transition-colors">
            Commit
          </button>
          <button className="inline-flex items-center gap-1 px-2 py-0.5 border border-border rounded bg-bg-tertiary text-text-secondary text-[calc(var(--font-size)-1px)] hover:bg-bg-hover hover:text-text-primary hover:border-accent-blue transition-colors">
            Push
          </button>
          <button className="inline-flex items-center gap-1 px-2 py-0.5 border border-border rounded bg-bg-tertiary text-text-secondary text-[calc(var(--font-size)-1px)] hover:bg-bg-hover hover:text-text-primary hover:border-accent-blue transition-colors">
            Pull
          </button>
          <button className="inline-flex items-center gap-1 px-2 py-0.5 border border-border rounded bg-bg-tertiary text-text-secondary text-[calc(var(--font-size)-1px)] hover:bg-bg-hover hover:text-text-primary hover:border-accent-blue transition-colors">
            <Plus size={11} />
            Branch
          </button>
          <button
            className="inline-flex items-center gap-1 px-2 py-0.5 border border-border rounded bg-bg-tertiary text-text-secondary text-[calc(var(--font-size)-1px)] hover:bg-bg-hover hover:text-text-primary hover:border-accent-blue transition-colors"
            onClick={onRefresh}
          >
            <RefreshCw size={11} />
            Refresh
          </button>
        </div>
      </div>

      {/* Changes header */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-[calc(var(--font-size)-1px)] font-semibold text-text-secondary uppercase tracking-wide">
            Changes
          </span>
          <span className="bg-bg-tertiary text-text-muted px-1.5 rounded-xl text-[10px]">
            {filteredChanged.length}
          </span>
        </div>
        <label className="flex items-center gap-1 cursor-pointer text-[10px] text-text-muted">
          <div
            className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center cursor-pointer ${
              selectAllState === "all"
                ? "bg-accent-blue border-accent-blue"
                : selectAllState === "some"
                  ? "border-accent-blue"
                  : "border-text-muted"
            }`}
            onClick={onToggleAll}
          >
            {selectAllState === "all" && <span className="text-white text-[8px] font-bold">✓</span>}
            {selectAllState === "some" && <span className="text-accent-blue text-[10px] font-bold">−</span>}
          </div>
          All
        </label>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-0.5 px-2.5 py-1 border-b border-border">
        {filterOptions.map((f) => (
          <button
            key={f}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
              activeFilter === f
                ? "text-accent-blue border border-accent-blue bg-[rgba(97,175,239,0.1)]"
                : "text-text-muted border border-transparent hover:text-text-secondary hover:bg-bg-tertiary"
            }`}
            onClick={() => setActiveFilter(f)}
          >
            {filterLabels[f]}
          </button>
        ))}
      </div>

      {/* Changed files list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="px-3 py-4 text-center text-text-muted text-[calc(var(--font-size)-1px)]">
            Loading...
          </div>
        ) : (
          renderFileList(filteredChanged, true)
        )}
      </div>

      {/* Unversioned files */}
      {unversionedFiles.length > 0 && (
        <>
          <div
            className="flex items-center justify-between px-2.5 py-1.5 border-t border-border cursor-pointer hover:bg-bg-tertiary"
            onClick={() => setUnversionedCollapsed(!unversionedCollapsed)}
          >
            <span className="text-[calc(var(--font-size)-1px)] font-semibold text-text-secondary uppercase tracking-wide">
              Unversioned Files
              <span className="ml-1.5 bg-bg-tertiary text-text-muted px-1.5 rounded-xl text-[10px]">
                {unversionedFiles.length}
              </span>
            </span>
            <span
              className="text-[8px] text-text-muted transition-transform"
              style={{ transform: unversionedCollapsed ? "rotate(-90deg)" : "" }}
            >
              ▼
            </span>
          </div>
          {!unversionedCollapsed && (
            <div className="max-h-[120px] overflow-y-auto border-t border-border">
              {renderFileList(unversionedFiles, false)}
            </div>
          )}
        </>
      )}

      {/* Commit form */}
      <div className="px-2.5 py-2 border-t border-border">
        <label className="flex items-center gap-1.5 mb-1.5 text-[calc(var(--font-size)-1px)] text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={amend}
            onChange={(e) => setAmend(e.target.checked)}
            className="accent-accent-blue"
          />
          Amend
        </label>
        <textarea
          className="w-full min-h-[48px] max-h-[90px] px-2 py-1.5 border border-border rounded bg-bg-primary text-text-primary text-[calc(var(--font-size))] resize-y outline-none transition-colors focus:border-accent-blue placeholder:text-text-muted leading-relaxed"
          placeholder="Commit message..."
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
        />
        <div className="flex items-center gap-1.5 mt-2">
          <button
            className="flex-1 py-1.5 rounded bg-accent-blue text-white text-[calc(var(--font-size))] font-semibold text-center hover:bg-[#4d9ee0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!commitMessage.trim() || selectedFiles.size === 0}
            onClick={handleCommit}
          >
            Commit
          </button>
          <button
            className="flex-1 py-1.5 rounded border border-accent-blue text-accent-blue text-[calc(var(--font-size))] font-semibold text-center hover:bg-[rgba(97,175,239,0.1)] transition-colors"
            disabled={!commitMessage.trim() || selectedFiles.size === 0}
            onClick={handleCommitPush}
          >
            Commit & Push...
          </button>
        </div>
      </div>
    </div>
  );
}

export default React.memo(ChangesPanel);

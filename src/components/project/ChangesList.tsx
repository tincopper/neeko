import React, { useMemo, useState, useCallback } from "react";
import type { FileChange } from "../../types";
import { cn } from "../../utils/cn";
import { Checkbox } from "../ui/checkbox";
import { Badge } from "../ui/badge";
import { ChevronRightIcon } from "../icons";
import { Undo2 } from "lucide-react";

interface ChangesListProps {
  files: FileChange[];
  selectedFiles: Set<string>;
  onToggleFile: (path: string) => void;
  onDiscardFile: (path: string) => void;
  onFileSelect?: (path: string) => void;
  loading: boolean;
}

type FilterStatus = "all" | "Modified" | "Added" | "Deleted" | "Renamed";

const STATUS_LABELS: Record<FilterStatus, string> = {
  all: "All",
  Modified: "M",
  Added: "A",
  Deleted: "D",
  Renamed: "R",
};

const ChangesList: React.FC<ChangesListProps> = ({
  files,
  selectedFiles,
  onToggleFile,
  onDiscardFile,
  onFileSelect,
  loading,
}) => {
  const [changesExpanded, setChangesExpanded] = useState(true);
  const [unversionedExpanded, setUnversionedExpanded] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>("all");

  const trackedFiles = useMemo(
    () => files.filter((f) => f.status !== "Untracked"),
    [files],
  );

  const untrackedFiles = useMemo(
    () => files.filter((f) => f.status === "Untracked"),
    [files],
  );

  const filteredTrackedFiles = useMemo(() => {
    if (filter === "all") return trackedFiles;
    return trackedFiles.filter((f) => f.status === filter);
  }, [trackedFiles, filter]);

  const trackedAdd = trackedFiles.reduce((s, f) => s + f.additions, 0);
  const trackedDel = trackedFiles.reduce((s, f) => s + f.deletions, 0);

  const isAllSelected = useCallback(
    (fileList: FileChange[]) =>
      fileList.length > 0 && fileList.every((f) => selectedFiles.has(f.path)),
    [selectedFiles],
  );

  const handleSelectGroup = useCallback(
    (fileList: FileChange[]) => {
      const allSel = isAllSelected(fileList);
      if (allSel) {
        fileList.forEach((f) => {
          if (selectedFiles.has(f.path)) onToggleFile(f.path);
        });
      } else {
        fileList.forEach((f) => {
          if (!selectedFiles.has(f.path)) onToggleFile(f.path);
        });
      }
    },
    [isAllSelected, selectedFiles, onToggleFile],
  );

  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-xs text-text-muted py-4">No changes</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      {/* ── Changes (tracked files) ── */}
      {trackedFiles.length > 0 && (
        <Section
          title="Changes"
          count={trackedFiles.length}
          additions={trackedAdd}
          deletions={trackedDel}
          expanded={changesExpanded}
          onToggle={() => setChangesExpanded((v) => !v)}
          files={filteredTrackedFiles}
          selectedFiles={selectedFiles}
          allSelected={isAllSelected(filteredTrackedFiles)}
          onSelectAll={() => handleSelectGroup(filteredTrackedFiles)}
          onToggleFile={onToggleFile}
          onFileSelect={onFileSelect}
          onDiscardFile={onDiscardFile}
          loading={loading}
          filter={
            <div className="flex items-center gap-1">
              {(["all", "Modified", "Added", "Deleted", "Renamed"] as FilterStatus[]).map(
                (s) => (
                  <button
                    key={s}
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded transition-colors duration-100",
                      filter === s
                        ? "bg-bg-tertiary text-text-primary"
                        : "text-text-muted hover:text-text-secondary",
                    )}
                    onClick={() => setFilter(s)}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ),
              )}
            </div>
          }
        />
      )}

      {/* ── Unversioned (untracked files) ── */}
      {untrackedFiles.length > 0 && (
        <Section
          title="Unversioned"
          count={untrackedFiles.length}
          expanded={unversionedExpanded}
          onToggle={() => setUnversionedExpanded((v) => !v)}
          files={untrackedFiles}
          selectedFiles={selectedFiles}
          allSelected={isAllSelected(untrackedFiles)}
          onSelectAll={() => handleSelectGroup(untrackedFiles)}
          onToggleFile={onToggleFile}
          onFileSelect={onFileSelect}
          onDiscardFile={onDiscardFile}
          loading={loading}
        />
      )}
    </div>
  );
};

// ── Reusable collapsible section ──

interface SectionProps {
  title: string;
  count: number;
  additions?: number;
  deletions?: number;
  expanded: boolean;
  onToggle: () => void;
  files: FileChange[];
  selectedFiles: Set<string>;
  allSelected: boolean;
  onSelectAll: () => void;
  onToggleFile: (path: string) => void;
  onFileSelect?: (path: string) => void;
  onDiscardFile: (path: string) => void;
  loading: boolean;
  filter?: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({
  title,
  count,
  additions,
  deletions,
  expanded,
  onToggle,
  files,
  selectedFiles,
  allSelected,
  onSelectAll,
  onToggleFile,
  onFileSelect,
  onDiscardFile,
  loading,
  filter,
}) => {
  return (
    <div className="flex flex-col shrink-0 mb-1">
      {/* Header: Chevron → Checkbox → Title → Count → Stats → Filter */}
      <div className="flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors duration-100 hover:bg-bg-hover select-none shrink-0">
        <ChevronRightIcon
          size={9}
          className={cn(
            "text-[0.6em] w-2.5 shrink-0 transition-transform duration-150 text-text-muted cursor-pointer",
            expanded && "rotate-90",
          )}
          onClick={onToggle}
        />
        <Checkbox
          checked={allSelected}
          onCheckedChange={onSelectAll}
        />
        <span
          className="text-[0.72em] font-semibold uppercase tracking-[0.06em] text-text-muted cursor-pointer hover:text-text-secondary"
          onClick={onToggle}
        >
          {title} ({count})
        </span>
        {additions != null && additions > 0 && (
          <span className="text-[#3fb950] text-[0.72em] font-semibold">+{additions}</span>
        )}
        {deletions != null && deletions > 0 && (
          <span className="text-[#f85149] text-[0.72em] font-semibold">-{deletions}</span>
        )}
        {filter && <span className="ml-auto">{filter}</span>}
      </div>

      {/* File list */}
      {expanded && (
        <div className="pl-4 min-w-max">
          {files.map((file) => {
            const isSelected = selectedFiles.has(file.path);
            return (
              <div
                key={file.path}
                className={cn(
                  "flex items-center gap-2 py-0.5 px-2.5 text-xs transition-colors duration-100 group cursor-pointer",
                  isSelected
                    ? "bg-accent-blue/5 text-text-primary"
                    : "text-text-secondary hover:bg-bg-hover",
                )}
                onClick={() => onFileSelect?.(file.path)}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleFile(file.path)}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                />
                <span className="shrink-0 font-mono text-[11px]">
                  {file.path}
                </span>
                <Badge
                  variant={
                    file.status === "Added"
                      ? "added"
                      : file.status === "Deleted"
                        ? "deleted"
                        : file.status === "Modified"
                          ? "modified"
                          : "default"
                  }
                  className="rounded-sm border-0 px-1 py-0 text-[10px]"
                >
                  {file.status === "Untracked"
                    ? "U"
                    : file.status[0]}
                </Badge>
                {(file.additions > 0 || file.deletions > 0) && (
                  <span className="text-[10px] font-mono shrink-0">
                    {file.additions > 0 && (
                      <span className="text-accent-green">+{file.additions}</span>
                    )}
                    {file.additions > 0 && file.deletions > 0 && " "}
                    {file.deletions > 0 && (
                      <span className="text-accent-red">-{file.deletions}</span>
                    )}
                  </span>
                )}
                <button
                  className="p-0.5 rounded text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors duration-100 opacity-0 group-hover:opacity-100"
                  title="Discard changes"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDiscardFile(file.path);
                  }}
                  disabled={loading}
                >
                  <Undo2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default React.memo(ChangesList);

import React, { useMemo, useState } from "react";
import type { FileChange } from "../../types";
import { cn } from "../../utils/cn";
import { Checkbox } from "../ui/checkbox";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Undo2 } from "lucide-react";

interface ChangesListProps {
  files: FileChange[];
  selectedFiles: Set<string>;
  onToggleFile: (path: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onStageSelected: () => void;
  onUnstageSelected: () => void;
  onDiscardFile: (path: string) => void;
  loading: boolean;
}

type FilterStatus = "all" | "Modified" | "Added" | "Deleted" | "Renamed" | "Untracked";

const STATUS_LABELS: Record<FilterStatus, string> = {
  all: "All",
  Modified: "M",
  Added: "A",
  Deleted: "D",
  Renamed: "R",
  Untracked: "U",
};

const ChangesList: React.FC<ChangesListProps> = ({
  files,
  selectedFiles,
  onToggleFile,
  onSelectAll,
  onDeselectAll,
  onStageSelected,
  onUnstageSelected,
  onDiscardFile,
  loading,
}) => {
  const [filter, setFilter] = useState<FilterStatus>("all");

  const filteredFiles = useMemo(() => {
    if (filter === "all") return files;
    return files.filter((f) => f.status === filter);
  }, [files, filter]);

  const allSelected =
    filteredFiles.length > 0 && filteredFiles.every((f) => selectedFiles.has(f.path));

  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-xs text-text-muted py-4">No changes</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-1 px-3 py-1 border-b border-border">
        <Checkbox
          checked={allSelected}
          onCheckedChange={() => (allSelected ? onDeselectAll() : onSelectAll())}
        />
        <span className="text-[0.72em] font-semibold uppercase tracking-[0.06em] text-text-muted mr-auto">
          Changes ({files.length})
        </span>

        <div className="flex items-center gap-1">
          {(["all", "Modified", "Added", "Deleted", "Untracked"] as FilterStatus[]).map(
            (s) => (
              <button
                key={s}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded transition-colors duration-100",
                  filter === s
                    ? "bg-bg-tertiary text-text-primary"
                    : "text-text-muted hover:text-text-secondary"
                )}
                onClick={() => setFilter(s)}
              >
                {STATUS_LABELS[s]}
              </button>
            )
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredFiles.map((file) => {
          const isSelected = selectedFiles.has(file.path);
          return (
            <div
              key={file.path}
              className={cn(
                "flex items-center gap-2 py-0.5 px-3 text-xs transition-colors duration-100 group",
                isSelected
                  ? "bg-accent-blue/5 text-text-primary"
                  : "text-text-secondary hover:bg-bg-hover"
              )}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => onToggleFile(file.path)}
              />
              <span className="flex-1 truncate font-mono text-[11px]">
                {file.path}
              </span>
              {file.status !== "Untracked" && (
                <Badge variant={file.status === "Added" ? "added" : file.status === "Deleted" ? "deleted" : file.status === "Modified" ? "modified" : "default"}>
                  {STATUS_LABELS[file.status]}
                </Badge>
              )}
              {file.status === "Untracked" && (
                <Badge variant="default">{STATUS_LABELS["Untracked"]}</Badge>
              )}
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
                onClick={() => onDiscardFile(file.path)}
                disabled={loading}
              >
                <Undo2 size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {filteredFiles.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1 border-t border-border shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="text-[11px]"
            onClick={onStageSelected}
            disabled={loading}
          >
            Stage Selected
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-[11px]"
            onClick={onUnstageSelected}
            disabled={loading}
          >
            Unstage Selected
          </Button>
        </div>
      )}
    </div>
  );
};

export default React.memo(ChangesList);

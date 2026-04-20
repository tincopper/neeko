import React, { useCallback } from "react";
import { FileText } from "lucide-react";
import type { CommitDetail as CommitDetailType, FileChange } from "../../types";

interface CommitDetailProps {
  detail: CommitDetailType | null;
  loading: boolean;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
  diffMode: "unified" | "split";
  onToggleDiffMode: () => void;
}

interface FileRowProps {
  file: FileChange;
  isSelected: boolean;
  onSelect: (filePath: string) => void;
}

function getStatusColor(status: string): string {
  switch (status) {
    case "Added": return "text-green-500 bg-green-500/15";
    case "Deleted": return "text-red-500 bg-red-500/15";
    case "Modified": return "text-yellow-500 bg-yellow-500/15";
    case "Renamed": return "text-blue-500 bg-blue-500/15";
    case "Untracked": return "text-gray-400 bg-gray-400/15";
    default: return "text-text-muted bg-bg-secondary";
  }
}

function getStatusLetter(status: string): string {
  switch (status) {
    case "Added": return "A";
    case "Deleted": return "D";
    case "Modified": return "M";
    case "Renamed": return "R";
    case "Untracked": return "U";
    default: return "?";
  }
}

function FileRow({ file, isSelected, onSelect }: FileRowProps) {
  const handleClick = useCallback(() => onSelect(file.path.toString()), [onSelect, file.path]);
  const statusLetter = getStatusLetter(file.status);
  const statusColor = getStatusColor(file.status);
  const fileName = file.path.toString().split("/").pop() ?? file.path.toString();
  const dirPath = file.path.toString().split("/").slice(0, -1).join("/");

  return (
    <div
      className={`flex items-center gap-2 px-3 py-[4px] cursor-pointer text-[var(--font-size)]
        ${isSelected ? "bg-accent/15" : "hover:bg-bg-hover"}
      `}
      onClick={handleClick}
    >
      <span className={`text-[10px] font-bold px-1 rounded ${statusColor} shrink-0`}>
        {statusLetter}
      </span>
      <FileText size={13} className="text-text-muted shrink-0" />
      <span className="text-text-primary truncate">{fileName}</span>
      {dirPath && (
        <span className="text-text-muted text-[calc(var(--font-size)-2px)] truncate ml-auto">
          {dirPath}
        </span>
      )}
      <div className="flex items-center gap-1 shrink-0 ml-1">
        {file.additions > 0 && <span className="text-green-500 text-[calc(var(--font-size)-1px)]">+{file.additions}</span>}
        {file.deletions > 0 && <span className="text-red-500 text-[calc(var(--font-size)-1px)]">-{file.deletions}</span>}
      </div>
    </div>
  );
}

const MemoizedFileRow = React.memo(FileRow);

function CommitDetailPanel({
  detail,
  loading,
  selectedFile,
  onSelectFile,
  diffMode,
  onToggleDiffMode,
}: CommitDetailProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-[var(--font-size)]">
        Loading...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-[var(--font-size)]">
        Select a commit to view details
      </div>
    );
  }

  const { commit, files } = detail;

  return (
    <div className="flex flex-col h-full">
      {/* Commit info header */}
      <div className="px-3 py-2 border-b border-border">
        <div className="font-mono text-[calc(var(--font-size)-1px)] text-accent">{commit.hash}</div>
        <div className="text-[var(--font-size)] text-text-primary font-medium mt-1">{commit.message}</div>
        <div className="text-[calc(var(--font-size)-1px)] text-text-muted mt-1">
          {commit.author} &lt;{commit.email}&gt; &middot; {commit.date}
        </div>
      </div>

      {/* File list */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-border">
        <span className="text-[var(--font-size)] text-text-secondary">
          Changed Files ({files.length})
        </span>
        <button
          className="text-[calc(var(--font-size)-1px)] text-accent hover:underline"
          onClick={onToggleDiffMode}
        >
          {diffMode === "unified" ? "Unified" : "Split"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <div className="px-3 py-4 text-center text-text-muted text-[var(--font-size)]">
            No files changed
          </div>
        ) : (
          files.map((file) => (
            <MemoizedFileRow
              key={file.path.toString()}
              file={file}
              isSelected={file.path.toString() === selectedFile}
              onSelect={onSelectFile}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default React.memo(CommitDetailPanel);

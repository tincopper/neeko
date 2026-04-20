import React, { useMemo, useState } from "react";
import type { DiffResult } from "../../types";

interface CommitDiffPanelProps {
  filePath: string | null;
  fileStatus: string | null;
  diffResult: DiffResult | null;
  loading: boolean;
}

interface DiffLineRow {
  type: "context" | "added" | "removed";
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

function buildLineRows(hunks: DiffResult["hunks"]): DiffLineRow[] {
  const rows: DiffLineRow[] = [];
  for (const hunk of hunks) {
    let oldLine = hunk.old_start;
    let newLine = hunk.new_start;
    for (const line of hunk.lines) {
      if ("Context" in line) {
        rows.push({
          type: "context",
          content: line.Context,
          oldLineNo: oldLine,
          newLineNo: newLine,
        });
        oldLine++;
        newLine++;
      } else if ("Added" in line) {
        rows.push({
          type: "added",
          content: line.Added,
          oldLineNo: null,
          newLineNo: newLine,
        });
        newLine++;
      } else if ("Removed" in line) {
        rows.push({
          type: "removed",
          content: line.Removed,
          oldLineNo: oldLine,
          newLineNo: null,
        });
        oldLine++;
      }
    }
  }
  return rows;
}

function UnifiedDiffView({ rows }: { rows: DiffLineRow[] }) {
  return (
    <div className="h-full overflow-auto font-mono text-[calc(var(--terminal-font-size,13px))]">
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={
                row.type === "added"
                  ? "bg-[rgba(152,195,121,0.08)]"
                  : row.type === "removed"
                    ? "bg-[rgba(224,108,117,0.08)]"
                    : ""
              }
            >
              <td className="w-10 text-right pr-2 text-text-muted select-none border-r border-border/50 text-[11px]">
                {row.oldLineNo ?? ""}
              </td>
              <td className="w-10 text-right pr-2 text-text-muted select-none border-r border-border/50 text-[11px]">
                {row.newLineNo ?? ""}
              </td>
              <td className="pl-2 whitespace-pre">
                <span
                  className={
                    row.type === "added"
                      ? "text-accent-green"
                      : row.type === "removed"
                        ? "text-accent-red"
                        : "text-text-primary"
                  }
                >
                  {row.type === "added" ? "+" : row.type === "removed" ? "-" : " "}
                </span>
                <span
                  className={
                    row.type === "added"
                      ? "text-[#98c379]"
                      : row.type === "removed"
                        ? "text-[#e06c75]"
                        : "text-text-primary"
                  }
                >
                  {row.content}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SplitDiffView({ rows }: { rows: DiffLineRow[] }) {
  const pairs: { left: DiffLineRow | null; right: DiffLineRow | null }[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.type === "context") {
      pairs.push({ left: row, right: row });
      i++;
    } else if (row.type === "removed") {
      const next = i + 1 < rows.length ? rows[i + 1] : null;
      if (next && next.type === "added") {
        pairs.push({ left: row, right: next });
        i += 2;
      } else {
        pairs.push({ left: row, right: null });
        i++;
      }
    } else if (row.type === "added") {
      pairs.push({ left: null, right: row });
      i++;
    } else {
      i++;
    }
  }

  return (
    <div className="h-full overflow-auto font-mono text-[calc(var(--terminal-font-size,13px))]">
      <table className="w-full border-collapse">
        <tbody>
          {pairs.map((pair, i) => (
            <tr key={i}>
              <td className="w-8 text-right pr-1 text-text-muted select-none border-r border-border/50 text-[11px]">
                {pair.left?.oldLineNo ?? ""}
              </td>
              <td
                className={`border-r border-border/50 px-1 whitespace-pre ${
                  pair.left?.type === "removed"
                    ? "bg-[rgba(224,108,117,0.08)] text-[#e06c75]"
                    : "text-text-primary"
                }`}
              >
                {pair.left ? (pair.left.type === "removed" ? "- " : "  ") + pair.left.content : ""}
              </td>
              <td className="w-8 text-right pr-1 text-text-muted select-none border-r border-border/50 text-[11px]">
                {pair.right?.newLineNo ?? ""}
              </td>
              <td
                className={`px-1 whitespace-pre ${
                  pair.right?.type === "added"
                    ? "bg-[rgba(152,195,121,0.08)] text-[#98c379]"
                    : "text-text-primary"
                }`}
              >
                {pair.right
                  ? (pair.right.type === "added" ? "+ " : "  ") + pair.right.content
                  : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  Modified: "text-[#e5c07b]",
  Added: "text-[#98c379]",
  Deleted: "text-[#e06c75]",
  Renamed: "text-[#c678dd]",
  Untracked: "text-[#5c6370]",
};

function CommitDiffPanel({ filePath, fileStatus, diffResult, loading }: CommitDiffPanelProps) {
  const [diffMode, setDiffMode] = useState<"unified" | "split">("unified");

  const rows = useMemo(() => {
    if (!diffResult) return [];
    return buildLineRows(diffResult.hunks);
  }, [diffResult]);

  // Toolbar
  const toolbar = (
    <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border bg-bg-secondary shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {filePath && (
          <>
            <span className="text-[calc(var(--font-size)-1px)] text-text-primary truncate font-medium">
              {filePath.split("/").pop()}
            </span>
            <span className="text-[10px] text-text-muted truncate">{filePath}</span>
            {fileStatus && (
              <span className={`text-[10px] font-medium ${STATUS_COLORS[fileStatus] ?? "text-text-muted"}`}>
                {fileStatus}
              </span>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-0.5 border border-border rounded overflow-hidden">
        <button
          className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
            diffMode === "unified"
              ? "bg-accent-blue text-white"
              : "text-text-muted hover:text-text-secondary hover:bg-bg-tertiary"
          }`}
          onClick={() => setDiffMode("unified")}
        >
          Unified
        </button>
        <button
          className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
            diffMode === "split"
              ? "bg-accent-blue text-white"
              : "text-text-muted hover:text-text-secondary hover:bg-bg-tertiary"
          }`}
          onClick={() => setDiffMode("split")}
        >
          Split
        </button>
      </div>
    </div>
  );

  if (!filePath) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-[calc(var(--font-size))]">
        Select a file to view diff
      </div>
    );
  }

  if (loading) {
    return (
      <>
        {toolbar}
        <div className="flex items-center justify-center flex-1 text-text-muted text-[calc(var(--font-size))]">
          Loading diff...
        </div>
      </>
    );
  }

  if (!diffResult || diffResult.hunks.length === 0) {
    return (
      <>
        {toolbar}
        <div className="flex items-center justify-center flex-1 text-text-muted text-[calc(var(--font-size))]">
          No changes to display
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {toolbar}
      <div className="flex-1 min-h-0">
        {diffMode === "unified" ? (
          <UnifiedDiffView rows={rows} />
        ) : (
          <SplitDiffView rows={rows} />
        )}
      </div>
    </div>
  );
}

export default React.memo(CommitDiffPanel);

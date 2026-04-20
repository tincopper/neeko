import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface CommitDiffViewProps {
  projectId: string;
  commitHash: string;
  filePath: string;
  diffMode: "unified" | "split";
}

type DiffLine = { Context: string } | { Added: string } | { Removed: string };

interface DiffHunk {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  lines: DiffLine[];
}

interface DiffResult {
  hunks: DiffHunk[];
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

function CommitDiffView({ projectId, commitHash, filePath, diffMode }: CommitDiffViewProps) {
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    invoke<DiffResult>("get_commit_file_diff", {
      projectId,
      commitHash,
      filePath,
    })
      .then((result) => {
        if (!cancelled) setDiffResult(result);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, commitHash, filePath]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-[var(--font-size)]">
        Loading diff...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-[var(--font-size)]">
        {error}
      </div>
    );
  }

  if (!diffResult || diffResult.hunks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-[var(--font-size)]">
        No diff available
      </div>
    );
  }

  const rows = buildLineRows(diffResult.hunks);

  if (diffMode === "split") {
    return <SplitDiffView rows={rows} />;
  }

  return <UnifiedDiffView rows={rows} />;
}

function UnifiedDiffView({ rows }: { rows: DiffLineRow[] }) {
  return (
    <div className="h-full overflow-auto font-mono text-[var(--terminal-font-size)]">
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={row.type === "added" ? "bg-green-500/10" : row.type === "removed" ? "bg-red-500/10" : ""}>
              <td className="w-10 text-right pr-2 text-text-muted select-none border-r border-border/50">
                {row.oldLineNo ?? ""}
              </td>
              <td className="w-10 text-right pr-2 text-text-muted select-none border-r border-border/50">
                {row.newLineNo ?? ""}
              </td>
              <td className="pl-2 whitespace-pre">
                <span className={row.type === "added" ? "text-green-400" : row.type === "removed" ? "text-red-400" : "text-text-primary"}>
                  {row.type === "added" ? "+" : row.type === "removed" ? "-" : " "}
                </span>
                <span className={row.type === "added" ? "text-green-300" : row.type === "removed" ? "text-red-300" : "text-text-primary"}>
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
  // Build paired rows for split view
  const pairs: { left: DiffLineRow | null; right: DiffLineRow | null }[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.type === "context") {
      pairs.push({ left: row, right: row });
      i++;
    } else if (row.type === "removed") {
      // Pair with next added line if available
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
    <div className="h-full overflow-auto font-mono text-[var(--terminal-font-size)]">
      <table className="w-full border-collapse">
        <tbody>
          {pairs.map((pair, i) => (
            <tr key={i}>
              {/* Left side */}
              <td className="w-8 text-right pr-1 text-text-muted select-none border-r border-border/50">
                {pair.left?.oldLineNo ?? ""}
              </td>
              <td className={`border-r border-border/50 px-1 whitespace-pre ${pair.left?.type === "removed" ? "bg-red-500/10 text-red-300" : "text-text-primary"}`}>
                {pair.left ? (pair.left.type === "removed" ? "- " : "  ") + pair.left.content : ""}
              </td>
              {/* Right side */}
              <td className="w-8 text-right pr-1 text-text-muted select-none border-r border-border/50">
                {pair.right?.newLineNo ?? ""}
              </td>
              <td className={`px-1 whitespace-pre ${pair.right?.type === "added" ? "bg-green-500/10 text-green-300" : "text-text-primary"}`}>
                {pair.right ? (pair.right.type === "added" ? "+ " : "  ") + pair.right.content : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default React.memo(CommitDiffView);

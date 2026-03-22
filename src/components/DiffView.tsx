import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fileIconSrc } from "../utils/fileIcons";

interface DiffLine {
  Context?: string;
  Added?: string;
  Removed?: string;
}

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

type ViewMode = "unified" | "split";

interface DiffViewProps {
  projectId: string;
  filePath: string;
  initialMode?: ViewMode;
  onBack: () => void;
}

interface SplitRow {
  type: "hunk-header" | "change" | "context";
  hunkHeader?: string;
  oldLineNum?: number;
  newLineNum?: number;
  oldContent?: string;
  newContent?: string;
  oldType?: "removed" | "context" | "empty";
  newType?: "added" | "context" | "empty";
}

function buildSplitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  rows.push({
    type: "hunk-header",
    hunkHeader: `@@ -${hunk.old_start},${hunk.old_lines} +${hunk.new_start},${hunk.new_lines} @@`,
  });

  const getType = (l: DiffLine) =>
    l.Added !== undefined ? "added" : l.Removed !== undefined ? "removed" : "context";
  const getContent = (l: DiffLine) =>
    l.Added ?? l.Removed ?? l.Context ?? "";

  let i = 0;
  let oldNum = hunk.old_start;
  let newNum = hunk.new_start;

  while (i < hunk.lines.length) {
    const line = hunk.lines[i];
    const t = getType(line);

    if (t === "context") {
      rows.push({
        type: "context",
        oldLineNum: oldNum,
        newLineNum: newNum,
        oldContent: getContent(line),
        newContent: getContent(line),
        oldType: "context",
        newType: "context",
      });
      oldNum++;
      newNum++;
      i++;
    } else {
      // 收集连续的 removed / added 块，配对显示
      const removed: DiffLine[] = [];
      const added: DiffLine[] = [];
      while (i < hunk.lines.length && getType(hunk.lines[i]) === "removed") {
        removed.push(hunk.lines[i++]);
      }
      while (i < hunk.lines.length && getType(hunk.lines[i]) === "added") {
        added.push(hunk.lines[i++]);
      }
      const maxLen = Math.max(removed.length, added.length);
      for (let j = 0; j < maxLen; j++) {
        const r = removed[j];
        const a = added[j];
        rows.push({
          type: "change",
          oldLineNum: r ? oldNum : undefined,
          newLineNum: a ? newNum : undefined,
          oldContent: r ? getContent(r) : undefined,
          newContent: a ? getContent(a) : undefined,
          oldType: r ? "removed" : "empty",
          newType: a ? "added" : "empty",
        });
        if (r) oldNum++;
        if (a) newNum++;
      }
    }
  }

  return rows;
}

const DiffView: React.FC<DiffViewProps> = ({ projectId, filePath, initialMode, onBack }) => {
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentHunkIndex, setCurrentHunkIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode ?? "unified");

  useEffect(() => {
    loadDiff();
  }, [projectId, filePath]);

  const loadDiff = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<DiffResult>("get_file_diff_command", {
        projectId,
        filePath,
      });
      setDiffResult(result);
      setCurrentHunkIndex(0);
    } catch (err) {
      setError(err as string);
    } finally {
      setLoading(false);
    }
  };

  const getLineContent = (line: DiffLine): string => {
    return line.Context ?? line.Added ?? line.Removed ?? "";
  };

  const getLineType = (line: DiffLine): string => {
    if (line.Context !== undefined) return "context";
    if (line.Added !== undefined) return "added";
    if (line.Removed !== undefined) return "removed";
    return "context";
  };

  const navigateHunk = (direction: "prev" | "next") => {
    if (!diffResult) return;
    if (direction === "prev" && currentHunkIndex > 0) {
      setCurrentHunkIndex(currentHunkIndex - 1);
    } else if (direction === "next" && currentHunkIndex < diffResult.hunks.length - 1) {
      setCurrentHunkIndex(currentHunkIndex + 1);
    }
  };

  const getFileName = (path: string): string => {
    return path.split(/[\\/]/).pop() || path;
  };

  if (loading) {
    return <div className="diff-container"><div className="diff-loading">Loading diff...</div></div>;
  }

  if (error) {
    return (
      <div className="diff-container">
        <div className="diff-error">
          <p>Error: {error}</p>
          <button onClick={loadDiff}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="diff-container">
      <div className="diff-header">
        <div className="diff-title">
          <img
            src={fileIconSrc(getFileName(filePath))}
            alt=""
            width={16}
            height={16}
            style={{ flexShrink: 0 }}
          />
          <span className="file-name">{getFileName(filePath)}</span>
          <span className="file-path">{filePath}</span>
          {diffResult && (
            <span className="hunk-count">
              {diffResult.hunks.length} change{diffResult.hunks.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="diff-actions">
          {/* 模式切换 */}
          <div className="diff-mode-toggle">
            <button
              className={`mode-btn ${viewMode === "unified" ? "active" : ""}`}
              onClick={() => setViewMode("unified")}
              title="Unified view"
            >
              Unified
            </button>
            <button
              className={`mode-btn ${viewMode === "split" ? "active" : ""}`}
              onClick={() => setViewMode("split")}
              title="Split view"
            >
              Split
            </button>
          </div>
          <button
            className="nav-btn"
            onClick={() => navigateHunk("prev")}
            disabled={currentHunkIndex === 0}
            title="Previous Change"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M9.78 12.78a.75.75 0 0 1-1.06 0L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L6.06 8l3.72 3.72a.75.75 0 0 1 0 1.06Z"/></svg>
          </button>
          <span className="hunk-index">
            {diffResult && diffResult.hunks.length > 0
              ? `${currentHunkIndex + 1} / ${diffResult.hunks.length}`
              : "0 / 0"}
          </span>
          <button
            className="nav-btn"
            onClick={() => navigateHunk("next")}
            disabled={!diffResult || currentHunkIndex >= diffResult.hunks.length - 1}
            title="Next Change"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/></svg>
          </button>
          <button className="back-btn" onClick={onBack} title="Back to Terminal">✕</button>
        </div>
      </div>

      <div className="diff-content">
        {diffResult && diffResult.hunks.length > 0 ? (
          viewMode === "unified" ? (
            /* ── Unified 模式 ── */
            <table className="diff-table">
              <tbody>
                {diffResult.hunks.map((hunk, hunkIndex) => {
                  let oldNum = hunk.old_start;
                  let newNum = hunk.new_start;
                  return (
                    <React.Fragment key={hunkIndex}>
                      <tr className="hunk-header">
                        <td colSpan={4}>
                          @@ -{hunk.old_start},{hunk.old_lines} +{hunk.new_start},{hunk.new_lines} @@
                        </td>
                      </tr>
                      {hunk.lines.map((line, lineIndex) => {
                        const lineType = getLineType(line);
                        const content = getLineContent(line);
                        const curOld = oldNum;
                        const curNew = newNum;
                        if (lineType !== "added") oldNum++;
                        if (lineType !== "removed") newNum++;
                        return (
                          <tr key={`${hunkIndex}-${lineIndex}`} className={`diff-line ${lineType}`}>
                            <td className="line-number old">{lineType !== "added" ? curOld : ""}</td>
                            <td className="line-number new">{lineType !== "removed" ? curNew : ""}</td>
                            <td className="line-indicator">
                              {lineType === "added" ? "+" : lineType === "removed" ? "-" : " "}
                            </td>
                            <td className="line-content">{content}</td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : (
            /* ── Split 模式 ── */
            <table className="diff-table diff-table-split">
              <colgroup>
                <col className="col-linenum" />
                <col className="col-code" />
                <col className="col-linenum" />
                <col className="col-code" />
              </colgroup>
              <tbody>
                {diffResult.hunks.map((hunk, hunkIndex) =>
                  buildSplitRows(hunk).map((row, rowIndex) => {
                    if (row.type === "hunk-header") {
                      return (
                        <tr key={`${hunkIndex}-${rowIndex}`} className="hunk-header">
                          <td colSpan={4}>{row.hunkHeader}</td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={`${hunkIndex}-${rowIndex}`} className="diff-line split-row">
                        {/* 左侧：旧代码 */}
                        <td className={`line-number old split-linenum ${row.oldType}`}>
                          {row.oldLineNum ?? ""}
                        </td>
                        <td className={`line-content split-cell ${row.oldType}`}>
                          {row.oldType === "removed" && <span className="split-indicator">-</span>}
                          {row.oldContent ?? ""}
                        </td>
                        {/* 右侧：新代码 */}
                        <td className={`line-number new split-linenum ${row.newType}`}>
                          {row.newLineNum ?? ""}
                        </td>
                        <td className={`line-content split-cell ${row.newType}`}>
                          {row.newType === "added" && <span className="split-indicator">+</span>}
                          {row.newContent ?? ""}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )
        ) : (
          <div className="no-changes">No changes to display</div>
        )}
      </div>
    </div>
  );
};

export default DiffView;

import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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

interface DiffViewProps {
  projectId: string;
  filePath: string;
  onBack: () => void;
}

const DiffView: React.FC<DiffViewProps> = ({ projectId, filePath, onBack }) => {
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentHunkIndex, setCurrentHunkIndex] = useState(0);

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
    if (line.Context !== undefined) return line.Context;
    if (line.Added !== undefined) return line.Added;
    if (line.Removed !== undefined) return line.Removed;
    return "";
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
    } else if (
      direction === "next" &&
      currentHunkIndex < diffResult.hunks.length - 1
    ) {
      setCurrentHunkIndex(currentHunkIndex + 1);
    }
  };

  const getFileName = (path: string): string => {
    return path.split("/").pop() || path;
  };

  if (loading) {
    return (
      <div className="diff-container">
        <div className="diff-loading">Loading diff...</div>
      </div>
    );
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
          <span className="file-icon">📄</span>
          <span className="file-name">{getFileName(filePath)}</span>
          <span className="file-path">{filePath}</span>
          {diffResult && (
            <span className="hunk-count">
              {diffResult.hunks.length} change{diffResult.hunks.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="diff-actions">
          <button
            className="nav-btn"
            onClick={() => navigateHunk("prev")}
            disabled={currentHunkIndex === 0}
            title="Previous Change"
          >
            ◀
          </button>
          <span className="hunk-index">
            {diffResult && diffResult.hunks.length > 0
              ? `${currentHunkIndex + 1} / ${diffResult.hunks.length}`
              : "0 / 0"}
          </span>
          <button
            className="nav-btn"
            onClick={() => navigateHunk("next")}
            disabled={
              !diffResult || currentHunkIndex >= diffResult.hunks.length - 1
            }
            title="Next Change"
          >
            ▶
          </button>
          <button className="back-btn" onClick={onBack} title="Back to Terminal">
            ✕
          </button>
        </div>
      </div>

      <div className="diff-content">
        {diffResult && diffResult.hunks.length > 0 ? (
          <table className="diff-table">
            <tbody>
              {diffResult.hunks.map((hunk, hunkIndex) => (
                <React.Fragment key={hunkIndex}>
                  <tr className="hunk-header">
                    <td colSpan={4}>
                      @@ -{hunk.old_start},{hunk.old_lines} +{hunk.new_start},
                      {hunk.new_lines} @@
                    </td>
                  </tr>
                  {hunk.lines.map((line, lineIndex) => {
                    const lineType = getLineType(line);
                    const content = getLineContent(line);
                    let oldLineNum = hunk.old_start;
                    let newLineNum = hunk.new_start;

                    // 计算行号
                    for (let i = 0; i < lineIndex; i++) {
                      const prevLine = hunk.lines[i];
                      const prevType = getLineType(prevLine);
                      if (prevType !== "added") oldLineNum++;
                      if (prevType !== "removed") newLineNum++;
                    }

                    return (
                      <tr
                        key={`${hunkIndex}-${lineIndex}`}
                        className={`diff-line ${lineType}`}
                      >
                        <td className="line-number old">
                          {lineType !== "added" ? oldLineNum : ""}
                        </td>
                        <td className="line-number new">
                          {lineType !== "removed" ? newLineNum : ""}
                        </td>
                        <td className="line-indicator">
                          {lineType === "added" ? "+" : lineType === "removed" ? "-" : " "}
                        </td>
                        <td className="line-content">{content}</td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="no-changes">No changes to display</div>
        )}
      </div>
    </div>
  );
};

export default DiffView;

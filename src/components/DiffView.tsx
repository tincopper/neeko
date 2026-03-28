import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AuthMethod } from "../types";
import { fileIconSrc } from "../utils/fileIcons";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import go from "highlight.js/lib/languages/go";
import ruby from "highlight.js/lib/languages/ruby";
import php from "highlight.js/lib/languages/php";
import swift from "highlight.js/lib/languages/swift";
import kotlin from "highlight.js/lib/languages/kotlin";
import scala from "highlight.js/lib/languages/scala";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import shell from "highlight.js/lib/languages/shell";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import diff from "highlight.js/lib/languages/diff";
import plaintext from "highlight.js/lib/languages/plaintext";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("java", java);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("go", go);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("php", php);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("scala", scala);
hljs.registerLanguage("css", css);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("plaintext", plaintext);

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

export type DiffSource =
  | { type: "local"; projectId: string }
  | { type: "wsl"; distro: string; projectPath: string }
  | { type: "remote"; entryId: string; host: string; port: number; username: string; auth: AuthMethod; projectPath: string };

interface DiffViewProps {
  projectId?: string;    // legacy — for local projects
  diffSource?: DiffSource;
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

const EXT_TO_LANG: Record<string, string> = {
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript",
  ".ts": "typescript", ".tsx": "typescript",
  ".py": "python", ".pyw": "python",
  ".rs": "rust",
  ".java": "java",
  ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".c": "cpp", ".h": "cpp", ".hpp": "cpp",
  ".cs": "csharp",
  ".go": "go",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin", ".kts": "kotlin",
  ".scala": "scala",
  ".css": "css", ".scss": "css", ".less": "css",
  ".html": "xml", ".htm": "xml", ".xml": "xml", ".svg": "xml",
  ".json": "json",
  ".yaml": "yaml", ".yml": "yaml",
  ".md": "markdown", ".mdx": "markdown",
  ".sql": "sql",
  ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".dockerfile": "dockerfile", "Dockerfile": "dockerfile",
  ".diff": "diff", ".patch": "diff",
  ".toml": "plaintext", ".lock": "plaintext", ".txt": "plaintext",
  ".gitignore": "plaintext", ".env": "plaintext",
};

function detectLanguage(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith("dockerfile")) return "dockerfile";
  const dotIdx = lower.lastIndexOf(".");
  if (dotIdx === -1) return "plaintext";
  const ext = lower.slice(dotIdx);
  return EXT_TO_LANG[ext] || "plaintext";
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlightLine(text: string, language: string): string {
  try {
    const result = hljs.highlight(text, { language, ignoreIllegals: true });
    return result.value;
  } catch {
    return escapeHtml(text);
  }
}

// ── Word-level diff using LCS ──

interface WordDiffPart {
  value: string;
  type: "equal" | "added" | "removed";
}

function tokenizeForDiff(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/[a-zA-Z0-9_\u4e00-\u9fff]/.test(ch)) {
      current += ch;
    } else {
      if (current) {
        tokens.push(current);
        current = "";
      }
      tokens.push(ch);
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function computeLCS(a: string[], b: string[]): boolean[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  const lcs: boolean[][] = Array.from({ length: m }, () => new Array(n).fill(false));
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs[i - 1][j - 1] = true;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return lcs;
}

function computeWordDiff(oldText: string, newText: string): { oldParts: WordDiffPart[]; newParts: WordDiffPart[] } {
  const oldTokens = tokenizeForDiff(oldText);
  const newTokens = tokenizeForDiff(newText);
  const lcs = computeLCS(oldTokens, newTokens);

  const oldParts: WordDiffPart[] = [];
  const newParts: WordDiffPart[] = [];

  let oi = 0, ni = 0;
  while (oi < oldTokens.length || ni < newTokens.length) {
    if (oi < oldTokens.length && ni < newTokens.length && lcs[oi][ni]) {
      // Both are in LCS → equal
      oldParts.push({ value: oldTokens[oi], type: "equal" });
      newParts.push({ value: newTokens[ni], type: "equal" });
      oi++;
      ni++;
    } else {
      // Collect removed tokens
      let removedChunk = "";
      while (oi < oldTokens.length && (ni >= newTokens.length || !lcs[oi][ni])) {
        removedChunk += oldTokens[oi];
        oi++;
      }
      if (removedChunk) {
        oldParts.push({ value: removedChunk, type: "removed" });
      }
      // Collect added tokens
      let addedChunk = "";
      while (ni < newTokens.length && (oi >= oldTokens.length || !lcs[oi][ni])) {
        addedChunk += newTokens[ni];
        ni++;
      }
      if (addedChunk) {
        newParts.push({ value: addedChunk, type: "added" });
      }
    }
  }
  return { oldParts, newParts };
}

// ── Render helpers ──

function renderHighlightedHtml(text: string, language: string): string {
  return highlightLine(text, language);
}

function renderWordDiffHtml(
  parts: WordDiffPart[],
  side: "old" | "new",
  language: string
): string {
  return parts
    .map((p) => {
      const escaped = highlightLine(p.value, language);
      if (p.type === "equal") return escaped;
      if (side === "old" && p.type === "removed") {
        return `<span class="word-diff-removed">${escaped}</span>`;
      }
      if (side === "new" && p.type === "added") {
        return `<span class="word-diff-added">${escaped}</span>`;
      }
      return escaped;
    })
    .join("");
}

// ── Split view builder with word-level diff ──

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
      const content = getContent(line);
      rows.push({
        type: "context",
        oldLineNum: oldNum,
        newLineNum: newNum,
        oldContent: content,
        newContent: content,
        oldType: "context",
        newType: "context",
      });
      oldNum++;
      newNum++;
      i++;
    } else {
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

const DiffView: React.FC<DiffViewProps> = ({ projectId, diffSource, filePath, initialMode, onBack }) => {
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode ?? "unified");

  const language = useMemo(() => detectLanguage(filePath), [filePath]);

  // 计算改动统计
  const changeStats = useMemo(() => {
    if (!diffResult) return { additions: 0, deletions: 0 };
    let additions = 0, deletions = 0;
    for (const hunk of diffResult.hunks) {
      for (const line of hunk.lines) {
        if (line.Added !== undefined) additions++;
        if (line.Removed !== undefined) deletions++;
      }
    }
    return { additions, deletions };
  }, [diffResult]);

  // 计算所有"连续改动块"的全局序号总数
  // 每当连续的 added/removed 行序列开始时，就是一个新块
  const totalChangeBlocks = useMemo((): number => {
    if (!diffResult) return 0;
    let count = 0;
    for (const hunk of diffResult.hunks) {
      let inBlock = false;
      for (const line of hunk.lines) {
        const isChanged = line.Added !== undefined || line.Removed !== undefined;
        if (isChanged && !inBlock) { count++; inBlock = true; }
        else if (!isChanged) { inBlock = false; }
      }
    }
    return count;
  }, [diffResult]);

  useEffect(() => {
    loadDiff();
  }, [projectId, diffSource, filePath]);

  const loadDiff = async () => {
    setLoading(true);
    setError(null);
    try {
      let result: DiffResult;
      if (diffSource?.type === "wsl") {
        result = await invoke<DiffResult>("get_wsl_file_diff_command", {
          distro: diffSource.distro,
          projectPath: diffSource.projectPath,
          filePath,
        });
      } else if (diffSource?.type === "remote") {
        result = await invoke<DiffResult>("get_remote_file_diff_command", {
          host: diffSource.host,
          port: diffSource.port,
          username: diffSource.username,
          auth: diffSource.auth,
          projectPath: diffSource.projectPath,
          filePath,
        });
      } else {
        result = await invoke<DiffResult>("get_file_diff_command", {
          projectId: projectId ?? diffSource?.projectId,
          filePath,
        });
      }
      setDiffResult(result);
      setCurrentBlockIndex(0);
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

  const navigateBlock = (direction: "prev" | "next") => {
    if (totalChangeBlocks === 0) return;
    let newIndex = currentBlockIndex;
    if (direction === "prev" && currentBlockIndex > 0) {
      newIndex = currentBlockIndex - 1;
    } else if (direction === "next" && currentBlockIndex < totalChangeBlocks - 1) {
      newIndex = currentBlockIndex + 1;
    }
    setCurrentBlockIndex(newIndex);
    requestAnimationFrame(() => {
      const el = document.getElementById(`cb-${newIndex}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
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
          {diffResult && (changeStats.additions > 0 || changeStats.deletions > 0) && (
            <span className="hunk-count">
              <span className="stat-additions">+{changeStats.additions}</span>
              {" "}
              <span className="stat-deletions">-{changeStats.deletions}</span>
            </span>
          )}
        </div>
        <div className="diff-actions">
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
            onClick={() => navigateBlock("prev")}
            disabled={totalChangeBlocks === 0 || currentBlockIndex === 0}
            title="Previous Change"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M9.78 12.78a.75.75 0 0 1-1.06 0L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L6.06 8l3.72 3.72a.75.75 0 0 1 0 1.06Z"/></svg>
          </button>
          <span className="hunk-index">
            {totalChangeBlocks > 0
              ? `${currentBlockIndex + 1} / ${totalChangeBlocks}`
              : "0 / 0"}
          </span>
          <button
            className="nav-btn"
            onClick={() => navigateBlock("next")}
            disabled={totalChangeBlocks === 0 || currentBlockIndex >= totalChangeBlocks - 1}
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
                {(() => {
                  let globalBlockIdx = 0;
                  return diffResult.hunks.map((hunk, hunkIndex) => {
                    let oldNum = hunk.old_start;
                    let newNum = hunk.new_start;
                    let inBlock = false;
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

                          const isChanged = lineType === "added" || lineType === "removed";
                          let blockId: string | undefined;
                          if (isChanged && !inBlock) {
                            blockId = `cb-${globalBlockIdx++}`;
                            inBlock = true;
                          } else if (!isChanged) {
                            inBlock = false;
                          }

                          let cellHtml = renderHighlightedHtml(content, language);
                          if (lineType === "removed") {
                            const nextLine = hunk.lines[lineIndex + 1];
                            if (nextLine && nextLine.Added !== undefined) {
                              const { oldParts } = computeWordDiff(content, nextLine.Added);
                              cellHtml = renderWordDiffHtml(oldParts, "old", language);
                            }
                          } else if (lineType === "added") {
                            const prevLine = hunk.lines[lineIndex - 1];
                            if (prevLine && prevLine.Removed !== undefined) {
                              const { newParts } = computeWordDiff(prevLine.Removed, content);
                              cellHtml = renderWordDiffHtml(newParts, "new", language);
                            }
                          }

                          return (
                            <tr
                              key={`${hunkIndex}-${lineIndex}`}
                              id={blockId}
                              className={`diff-line ${lineType}`}
                            >
                              <td className="line-number old">{lineType !== "added" ? curOld : ""}</td>
                              <td className="line-number new">{lineType !== "removed" ? curNew : ""}</td>
                              <td className="line-indicator">
                                {lineType === "added" ? "+" : lineType === "removed" ? "-" : " "}
                              </td>
                              <td className="line-content" dangerouslySetInnerHTML={{ __html: cellHtml }} />
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  });
                })()}
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
                {(() => {
                  let globalBlockIdx = 0;
                  return diffResult.hunks.map((hunk, hunkIndex) => {
                    let inBlock = false;
                    return buildSplitRows(hunk).map((row, rowIndex) => {
                      if (row.type === "hunk-header") {
                        return (
                          <tr key={`${hunkIndex}-${rowIndex}`} className="hunk-header">
                            <td colSpan={4}>{row.hunkHeader}</td>
                          </tr>
                        );
                      }

                      const isChanged = row.type === "change" && (row.oldType === "removed" || row.newType === "added");
                      let blockId: string | undefined;
                      if (isChanged && !inBlock) {
                        blockId = `cb-${globalBlockIdx++}`;
                        inBlock = true;
                      } else if (!isChanged) {
                        inBlock = false;
                      }

                      let oldCellHtml = "";
                      let newCellHtml = "";
                      if (row.type === "context") {
                        const highlighted = renderHighlightedHtml(row.oldContent || "", language);
                        oldCellHtml = highlighted;
                        newCellHtml = highlighted;
                      } else if (row.type === "change") {
                        if (row.oldType === "removed" && row.newType === "added" && row.oldContent && row.newContent) {
                          const { oldParts, newParts } = computeWordDiff(row.oldContent, row.newContent);
                          oldCellHtml = renderWordDiffHtml(oldParts, "old", language);
                          newCellHtml = renderWordDiffHtml(newParts, "new", language);
                        } else if (row.oldType === "removed" && row.oldContent) {
                          oldCellHtml = renderHighlightedHtml(row.oldContent, language);
                        } else if (row.newType === "added" && row.newContent) {
                          newCellHtml = renderHighlightedHtml(row.newContent, language);
                        }
                      }

                      return (
                        <tr
                          key={`${hunkIndex}-${rowIndex}`}
                          id={blockId}
                          className="diff-line split-row"
                        >
                          <td className={`line-number old split-linenum ${row.oldType}`}>
                            {row.oldLineNum ?? ""}
                          </td>
                          <td className={`line-content split-cell ${row.oldType}`}
                            dangerouslySetInnerHTML={{ __html: oldCellHtml || (row.oldType === "empty" ? "" : row.oldContent || "") }}
                          />
                          <td className={`line-number new split-linenum ${row.newType}`}>
                            {row.newLineNum ?? ""}
                          </td>
                          <td className={`line-content split-cell ${row.newType}`}
                            dangerouslySetInnerHTML={{ __html: newCellHtml || (row.newType === "empty" ? "" : row.newContent || "") }}
                          />
                        </tr>
                      );
                    });
                  });
                })()}
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

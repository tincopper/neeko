import React, { useEffect, useMemo, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AuthMethod } from "../types";
import { fileIconSrc } from "../utils/fileIcons";
import { ChevronRightIcon } from "./icons";
import { cn } from "../utils/cn";
import hljs from "highlight.js/lib/core";

const LANGUAGE_MAP: Record<string, () => Promise<unknown>> = {
  javascript: () => import("highlight.js/lib/languages/javascript"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  python: () => import("highlight.js/lib/languages/python"),
  rust: () => import("highlight.js/lib/languages/rust"),
  java: () => import("highlight.js/lib/languages/java"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  go: () => import("highlight.js/lib/languages/go"),
  ruby: () => import("highlight.js/lib/languages/ruby"),
  php: () => import("highlight.js/lib/languages/php"),
  swift: () => import("highlight.js/lib/languages/swift"),
  kotlin: () => import("highlight.js/lib/languages/kotlin"),
  scala: () => import("highlight.js/lib/languages/scala"),
  css: () => import("highlight.js/lib/languages/css"),
  xml: () => import("highlight.js/lib/languages/xml"),
  json: () => import("highlight.js/lib/languages/json"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  sql: () => import("highlight.js/lib/languages/sql"),
  shell: () => import("highlight.js/lib/languages/shell"),
  dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
  diff: () => import("highlight.js/lib/languages/diff"),
  plaintext: () => import("highlight.js/lib/languages/plaintext"),
};

type LanguageFn = (hljs: import("highlight.js").HLJSApi) => import("highlight.js").Language;

const registeredLangs = new Set<string>();

async function ensureLanguageRegistered(lang: string): Promise<void> {
  if (registeredLangs.has(lang)) return;
  const loader = LANGUAGE_MAP[lang];
  if (loader) {
    const mod = await loader();
    hljs.registerLanguage(lang, (mod as { default: LanguageFn }).default);
    registeredLangs.add(lang);
  }
}

export interface DiffLine {
  Context?: string;
  Added?: string;
  Removed?: string;
}

export interface DiffHunk {
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
  | { type: "remote"; entryId: string; host: string; port: number; username: string; auth: AuthMethod; projectPath: string }
  | { type: "worktree"; projectId: string; worktreePath: string };

interface DiffViewProps {
  projectId?: string;
  diffSource?: DiffSource;
  filePath: string;
  initialMode?: ViewMode;
  onBack: () => void;
}

export interface SplitRow {
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

export function detectLanguage(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith("dockerfile")) return "dockerfile";
  const dotIdx = lower.lastIndexOf(".");
  if (dotIdx === -1) return "plaintext";
  const ext = lower.slice(dotIdx);
  return EXT_TO_LANG[ext] || "plaintext";
}

export function escapeHtml(str: string): string {
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

// Word-level diff using LCS

export interface WordDiffPart {
  value: string;
  type: "equal" | "added" | "removed";
}

export function tokenizeForDiff(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/[a-zA-Z0-9_\u4e00-\u9fff]/.test(ch)) {
      current += ch;
    } else {
      if (current) { tokens.push(current); current = ""; }
      tokens.push(ch);
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

export function computeLCS(a: string[], b: string[]): boolean[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) { dp[i][j] = dp[i - 1][j - 1] + 1; }
      else { dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]); }
    }
  }
  const lcs: boolean[][] = Array.from({ length: m }, () => new Array(n).fill(false));
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { lcs[i - 1][j - 1] = true; i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) { i--; }
    else { j--; }
  }
  return lcs;
}

export function computeWordDiff(oldText: string, newText: string): { oldParts: WordDiffPart[]; newParts: WordDiffPart[] } {
  const oldTokens = tokenizeForDiff(oldText);
  const newTokens = tokenizeForDiff(newText);
  const lcs = computeLCS(oldTokens, newTokens);
  const oldParts: WordDiffPart[] = [];
  const newParts: WordDiffPart[] = [];
  let oi = 0, ni = 0;
  while (oi < oldTokens.length || ni < newTokens.length) {
    if (oi < oldTokens.length && ni < newTokens.length && lcs[oi][ni]) {
      oldParts.push({ value: oldTokens[oi], type: "equal" });
      newParts.push({ value: newTokens[ni], type: "equal" });
      oi++; ni++;
    } else {
      let removedChunk = "";
      while (oi < oldTokens.length && (ni >= newTokens.length || !lcs[oi][ni])) { removedChunk += oldTokens[oi]; oi++; }
      if (removedChunk) oldParts.push({ value: removedChunk, type: "removed" });
      let addedChunk = "";
      while (ni < newTokens.length && (oi >= oldTokens.length || !lcs[oi][ni])) { addedChunk += newTokens[ni]; ni++; }
      if (addedChunk) newParts.push({ value: addedChunk, type: "added" });
    }
  }
  return { oldParts, newParts };
}

// Render helpers

function renderHighlightedHtml(text: string, language: string): string {
  return highlightLine(text, language);
}

function renderWordDiffHtml(parts: WordDiffPart[], side: "old" | "new", language: string): string {
  return parts.map((p) => {
    const escaped = highlightLine(p.value, language);
    if (p.type === "equal") return escaped;
    if (side === "old" && p.type === "removed") return `<span class="word-diff-removed">${escaped}</span>`;
    if (side === "new" && p.type === "added") return `<span class="word-diff-added">${escaped}</span>`;
    return escaped;
  }).join("");
}

// Split view builder with word-level diff

export function buildSplitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  rows.push({ type: "hunk-header", hunkHeader: `@@ -${hunk.old_start},${hunk.old_lines} +${hunk.new_start},${hunk.new_lines} @@` });
  const getType = (l: DiffLine) => l.Added !== undefined ? "added" : l.Removed !== undefined ? "removed" : "context";
  const getContent = (l: DiffLine) => l.Added ?? l.Removed ?? l.Context ?? "";
  let i = 0, oldNum = hunk.old_start, newNum = hunk.new_start;
  while (i < hunk.lines.length) {
    const line = hunk.lines[i];
    const t = getType(line);
    if (t === "context") {
      const content = getContent(line);
      rows.push({ type: "context", oldLineNum: oldNum, newLineNum: newNum, oldContent: content, newContent: content, oldType: "context", newType: "context" });
      oldNum++; newNum++; i++;
    } else {
      const removed: DiffLine[] = [];
      const added: DiffLine[] = [];
      while (i < hunk.lines.length && getType(hunk.lines[i]) === "removed") { removed.push(hunk.lines[i++]); }
      while (i < hunk.lines.length && getType(hunk.lines[i]) === "added") { added.push(hunk.lines[i++]); }
      const maxLen = Math.max(removed.length, added.length);
      for (let j = 0; j < maxLen; j++) {
        const r = removed[j], a = added[j];
        rows.push({
          type: "change", oldLineNum: r ? oldNum : undefined, newLineNum: a ? newNum : undefined,
          oldContent: r ? getContent(r) : undefined, newContent: a ? getContent(a) : undefined,
          oldType: r ? "removed" : "empty", newType: a ? "added" : "empty",
        });
        if (r) oldNum++; if (a) newNum++;
      }
    }
  }
  return rows;
}

const DiffView: React.FC<DiffViewProps> = React.memo(({ projectId, diffSource, filePath, initialMode, onBack }) => {
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode ?? "unified");
  const lastLoadKeyRef = useRef<string>("");

  const language = useMemo(() => detectLanguage(filePath), [filePath]);

  useEffect(() => { ensureLanguageRegistered(language); }, [language]);

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
    const key = `${projectId ?? ""}|${JSON.stringify(diffSource ?? "")}|${filePath}`;
    if (key === lastLoadKeyRef.current) return;
    lastLoadKeyRef.current = key;
    loadDiff();
  }, [projectId, diffSource, filePath]);

  const loadDiff = async () => {
    setLoading(true);
    setError(null);
    try {
      let result: DiffResult;
      if (diffSource?.type === "wsl") {
        result = await invoke<DiffResult>("get_wsl_file_diff_command", { distro: diffSource.distro, projectPath: diffSource.projectPath, filePath });
      } else if (diffSource?.type === "remote") {
        result = await invoke<DiffResult>("get_remote_file_diff_command", { host: diffSource.host, port: diffSource.port, username: diffSource.username, auth: diffSource.auth, projectPath: diffSource.projectPath, filePath });
      } else if (diffSource?.type === "worktree") {
        result = await invoke<DiffResult>("get_worktree_file_diff", { projectId: diffSource.projectId, worktreePath: diffSource.worktreePath, filePath });
      } else {
        result = await invoke<DiffResult>("get_file_diff_command", { projectId: projectId ?? diffSource?.projectId, filePath });
      }
      setDiffResult(result);
      setCurrentBlockIndex(0);
    } catch (err) {
      setError(err as string);
    } finally {
      setLoading(false);
    }
  };

  const getLineContent = (line: DiffLine): string => line.Context ?? line.Added ?? line.Removed ?? "";
  const getLineType = (line: DiffLine): string => {
    if (line.Context !== undefined) return "context";
    if (line.Added !== undefined) return "added";
    if (line.Removed !== undefined) return "removed";
    return "context";
  };

  const navigateBlock = (direction: "prev" | "next") => {
    if (totalChangeBlocks === 0) return;
    let newIndex = currentBlockIndex;
    if (direction === "prev" && currentBlockIndex > 0) newIndex = currentBlockIndex - 1;
    else if (direction === "next" && currentBlockIndex < totalChangeBlocks - 1) newIndex = currentBlockIndex + 1;
    setCurrentBlockIndex(newIndex);
    requestAnimationFrame(() => {
      const el = document.getElementById(`cb-${newIndex}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const getFileName = (path: string): string => path.split(/[\\/]/).pop() || path;

  if (loading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-center h-full text-text-muted text-[var(--font-size)]">Loading diff...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-center h-full text-text-muted text-[var(--font-size)] flex-col gap-3">
          <p>Error: {error}</p>
          <button className="py-2 px-4 bg-accent-blue border-none rounded text-white cursor-pointer" onClick={loadDiff}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between py-2 px-4 bg-bg-secondary border-b border-border">
        <div className="flex items-center gap-2">
          <img src={fileIconSrc(getFileName(filePath))} alt="" width={16} height={16} className="shrink-0" />
          <span className="font-semibold">{getFileName(filePath)}</span>
          <span className="text-text-muted text-sm">{filePath}</span>
          {diffResult && (changeStats.additions > 0 || changeStats.deletions > 0) && (
            <span className="bg-bg-tertiary py-0.5 px-2 rounded-full text-xs text-text-secondary flex gap-1">
              <span className="text-[#3fb950] font-semibold">+{changeStats.additions}</span>
              {" "}
              <span className="text-[#f85149] font-semibold">-{changeStats.deletions}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-border rounded overflow-hidden">
            <button
              className={cn("bg-transparent border-none text-text-secondary px-2.5 py-1 cursor-pointer text-sm transition-all duration-150 hover:bg-bg-hover hover:text-text-primary border-r border-border [&:last-child]:border-r-0", viewMode === "unified" && "!bg-accent-blue !text-white")}
              onClick={() => setViewMode("unified")} title="Unified view">Unified</button>
            <button
              className={cn("bg-transparent border-none text-text-secondary px-2.5 py-1 cursor-pointer text-sm transition-all duration-150 hover:bg-bg-hover hover:text-text-primary [&:last-child]:border-r-0", viewMode === "split" && "!bg-accent-blue !text-white")}
              onClick={() => setViewMode("split")} title="Split view">Split</button>
          </div>
          <button className="bg-bg-tertiary border border-border text-text-primary px-2.5 py-1 rounded cursor-pointer text-sm transition-all duration-200 hover:bg-bg-hover hover:border-accent-blue disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => navigateBlock("prev")} disabled={totalChangeBlocks === 0 || currentBlockIndex === 0} title="Previous Change">
            <ChevronRightIcon size={14} style={{ transform: "rotate(180deg)" }} />
          </button>
          <span className="text-sm text-text-secondary min-w-[60px] text-center">
            {totalChangeBlocks > 0 ? `${currentBlockIndex + 1} / ${totalChangeBlocks}` : "0 / 0"}
          </span>
          <button className="bg-bg-tertiary border border-border text-text-primary px-2.5 py-1 rounded cursor-pointer text-sm transition-all duration-200 hover:bg-bg-hover hover:border-accent-blue disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => navigateBlock("next")} disabled={totalChangeBlocks === 0 || currentBlockIndex >= totalChangeBlocks - 1} title="Next Change">
            <ChevronRightIcon size={14} />
          </button>
          <button className="bg-transparent border-none text-text-secondary text-lg cursor-pointer px-2 py-1 rounded transition-all duration-200 hover:bg-bg-hover hover:text-text-primary" onClick={onBack} title="Back to Terminal">&times;</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-bg-primary">
        {diffResult && diffResult.hunks.length > 0 ? (
          viewMode === "unified" ? (
            <table className="w-full border-collapse font-mono text-base">
              <tbody>
                {(() => {
                  let globalBlockIdx = 0;
                  return diffResult.hunks.map((hunk, hunkIndex) => {
                    let oldNum = hunk.old_start;
                    let newNum = hunk.new_start;
                    let inBlock = false;
                    return (
                      <React.Fragment key={hunkIndex}>
                        <tr className="bg-bg-tertiary text-accent-blue font-medium">
                          <td colSpan={4} className="py-1 px-2">
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
                          if (isChanged && !inBlock) { blockId = `cb-${globalBlockIdx++}`; inBlock = true; }
                          else if (!isChanged) { inBlock = false; }

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
                              className={cn("border-none", lineType === "added" && "bg-diff-added", lineType === "removed" && "bg-diff-removed")}
                            >
                              <td className="w-[50px] text-right text-text-muted select-none">{lineType !== "added" ? curOld : ""}</td>
                              <td className="w-[50px] text-right text-text-muted select-none">{lineType !== "removed" ? curNew : ""}</td>
                              <td className="w-5 text-center select-none">
                                {lineType === "added" ? "+" : lineType === "removed" ? "-" : " "}
                              </td>
                              <td className="whitespace-pre-wrap break-all" dangerouslySetInnerHTML={{ __html: cellHtml }} />
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
            /* Split mode */
            <table className="w-full border-collapse font-mono text-base diff-table-split">
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
                          <tr key={`${hunkIndex}-${rowIndex}`} className="bg-bg-tertiary text-accent-blue font-medium">
                            <td colSpan={4} className="py-1 px-2">{row.hunkHeader}</td>
                          </tr>
                        );
                      }

                      const isChanged = row.type === "change" && (row.oldType === "removed" || row.newType === "added");
                      let blockId: string | undefined;
                      if (isChanged && !inBlock) { blockId = `cb-${globalBlockIdx++}`; inBlock = true; }
                      else if (!isChanged) { inBlock = false; }

                      let oldCellHtml = "", newCellHtml = "";
                      if (row.type === "context") {
                        const highlighted = renderHighlightedHtml(row.oldContent || "", language);
                        oldCellHtml = highlighted; newCellHtml = highlighted;
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
                        <tr key={`${hunkIndex}-${rowIndex}`} id={blockId} className="diff-line split-row">
                          <td className={cn("line-number old split-linenum", row.oldType)}>
                            {row.oldLineNum ?? ""}
                          </td>
                          <td className={cn("line-content split-cell", row.oldType)}
                            dangerouslySetInnerHTML={{ __html: oldCellHtml || (row.oldType === "empty" ? "" : row.oldContent || "") }} />
                          <td className={cn("line-number new split-linenum", row.newType)}>
                            {row.newLineNum ?? ""}
                          </td>
                          <td className={cn("line-content split-cell", row.newType)}
                            dangerouslySetInnerHTML={{ __html: newCellHtml || (row.newType === "empty" ? "" : row.newContent || "") }} />
                        </tr>
                      );
                    });
                  });
                })()}
              </tbody>
            </table>
          )
        ) : (
          <div className="flex items-center justify-center h-full text-text-muted text-[var(--font-size)]">No changes to display</div>
        )}
      </div>
    </div>
  );
});

export default DiffView;

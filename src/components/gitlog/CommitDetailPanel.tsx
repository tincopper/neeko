import React, { useCallback } from "react";
import type { CommitDetail, CommitFileChange } from "../../types";
import {
  GitCommitHorizontal,
  FileText,
  Plus,
  Minus,
  Pencil,
  Trash2,
  FilePlus,
} from "lucide-react";
import { cn } from "../../utils/cn";

interface CommitDetailPanelProps {
  detail: CommitDetail | null;
  files: CommitFileChange[];
  loading: boolean;
  error: string | null;
  onOpenDiff: (filePath: string) => void;
}

// ── Commit message 解析 ──────────────────────────────────────────────────────

/**
 * 按 Git commit message 规范拆分：
 *   - header：第一行（type(scope): subject 或普通文字）
 *   - body：header 后跳过空行的主体段落（\n\n 分段）
 *   - footer：body 后跳过空行、以 token: value 或 BREAKING CHANGE 开头的尾部
 *
 * Footer token 规范（Conventional Commits）：
 *   word-token: value  |  BREAKING CHANGE: value  |  word-token #value
 */
const FOOTER_TOKEN_RE = /^[\w-]+(?::\s|\s#)|^BREAKING[- ]CHANGE(?::\s|\s#)/;

function parseMessage(raw: string): {
  header: string;
  type: string;
  scope: string;
  subject: string;
  body: string[];
  footer: string[];
} {
  const lines = raw.replace(/\r\n/g, "\n").trimEnd().split("\n");
  const header = lines[0] ?? "";

  // 解析 conventional commits header
  const m = header.match(/^(\w+)(?:\(([^)]*)\))?!?:\s*(.*)/);
  const type    = m?.[1] ?? "";
  const scope   = m?.[2] ?? "";
  const subject = m?.[3] ?? (type ? "" : header);

  // 剩余行（跳过 header 后的空行）
  let rest = lines.slice(1);
  while (rest.length > 0 && rest[0].trim() === "") rest = rest.slice(1);

  if (rest.length === 0) return { header, type, scope, subject, body: [], footer: [] };

  // 从末尾找 footer 块（连续的 token 行，前面有空行分隔）
  // 先找最后一个空行的位置
  let footerStart = -1;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (rest[i].trim() === "") {
      // 检查 i+1 之后的所有行是否都是 footer token
      const candidate = rest.slice(i + 1);
      if (
        candidate.length > 0 &&
        candidate.every((l) => FOOTER_TOKEN_RE.test(l) || l.trim() === "" || /^\s/.test(l))
      ) {
        footerStart = i + 1;
      }
      break;
    }
  }

  const bodyLines = footerStart >= 0 ? rest.slice(0, footerStart) : rest;
  const footerLines = footerStart >= 0 ? rest.slice(footerStart) : [];

  // body 按空行分段，每段作为一个元素
  const bodyParagraphs: string[] = [];
  let cur: string[] = [];
  for (const l of bodyLines) {
    if (l.trim() === "") {
      if (cur.length > 0) { bodyParagraphs.push(cur.join("\n")); cur = []; }
    } else {
      cur.push(l);
    }
  }
  if (cur.length > 0) bodyParagraphs.push(cur.join("\n"));

  return { header, type, scope, subject, body: bodyParagraphs, footer: footerLines };
}

// ── CommitMessage 渲染组件 ───────────────────────────────────────────────────

function CommitMessage({ message }: { message: string }) {
  const { type, scope, subject, body, footer } = parseMessage(message);

  return (
    <div className="space-y-1.5">
      {/* Header 行：type badge + scope + subject */}
      <div className="flex items-start gap-1.5 flex-wrap">
        {type && (
          <span className={cn(
            "shrink-0 text-[calc(var(--font-size)-3px)] font-medium px-1.5 py-0.5 rounded leading-none mt-px",
            typeBadgeStyle(type),
          )}>
            {type}{scope ? `(${scope})` : ""}
          </span>
        )}
        <span className="text-[var(--font-size)] font-medium text-text-primary leading-snug break-words min-w-0">
          {subject || (type ? "" : message.split("\n")[0])}
        </span>
      </div>

      {/* Body 段落 */}
      {body.map((para, i) => (
        <p key={i} className="text-[calc(var(--font-size)-1px)] text-text-secondary leading-relaxed whitespace-pre-wrap break-words pl-0.5">
          {para}
        </p>
      ))}

      {/* Footer token 行 */}
      {footer.length > 0 && (
        <div className="border-t border-border/50 pt-1.5 space-y-0.5">
          {footer.map((line, i) => {
            const fm = line.match(/^([\w-]+|BREAKING[- ]CHANGE)(?::\s*|\s#)(.*)/);
            if (fm) {
              const isBreaking = fm[1].toUpperCase().includes("BREAKING");
              return (
                <div key={i} className="flex items-start gap-1.5 text-[calc(var(--font-size)-2px)]">
                  <span className={cn(
                    "shrink-0 font-mono font-medium",
                    isBreaking ? "text-accent-red" : "text-text-muted",
                  )}>
                    {fm[1]}:
                  </span>
                  <span className="text-text-secondary break-words">{fm[2]}</span>
                </div>
              );
            }
            return (
              <p key={i} className="text-[calc(var(--font-size)-2px)] text-text-muted whitespace-pre-wrap break-words">
                {line}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

function typeBadgeStyle(type: string): string {
  switch (type) {
    case "feat":     return "bg-accent-blue/15 text-accent-blue";
    case "fix":      return "bg-accent-red/15 text-accent-red";
    case "perf":     return "bg-accent-green/15 text-accent-green";
    case "revert":   return "bg-accent-red/10 text-accent-red";
    default:         return "bg-bg-tertiary text-text-muted";
  }
}

// ────────────────────────────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  M: { icon: <Pencil size={10} />, color: "text-accent-blue" },
  A: { icon: <FilePlus size={10} />, color: "text-accent-green" },
  D: { icon: <Trash2 size={10} />, color: "text-accent-red" },
  R: { icon: <FileText size={10} />, color: "text-accent-orange" },
};

const CommitDetailPanel: React.FC<CommitDetailPanelProps> = ({
  detail,
  files,
  loading,
  error,
  onOpenDiff,
}) => {
  const handleDoubleClick = useCallback(
    (filePath: string) => {
      onOpenDiff(filePath);
    },
    [onOpenDiff],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--font-size)] text-text-muted">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-[var(--font-size)] text-accent-red">
        {error}
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--font-size)] text-text-muted">
        Select a commit to view details
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-1.5 gap-1 overflow-hidden">
      {/* Commit info card */}
      <div className="bg-bg-tertiary/30 rounded-md p-2 shrink-0">
        {/* hash + refs */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <GitCommitHorizontal size={12} className="text-text-muted shrink-0" />
          <span className="text-[var(--font-size)] font-mono text-accent-blue shrink-0">
            {detail.short_hash}
          </span>
          {detail.refs && (
            <span className="text-[calc(var(--font-size)-3px)] font-medium px-1 py-px rounded bg-accent-yellow/10 text-accent-yellow truncate">
              {refsLabel(detail.refs)}
            </span>
          )}
        </div>

        {/* message: header / body / footer 分区 */}
        <CommitMessage message={detail.message} />

        {/* author · email · time */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1.5 text-[calc(var(--font-size)-2px)] text-text-muted">
          <span className="font-medium text-text-secondary">{detail.author}</span>
          <span className="opacity-50">·</span>
          <span>{detail.email}</span>
          <span className="opacity-50">·</span>
          <span className="shrink-0">{formatTimestamp(detail.timestamp)}</span>
        </div>

        {/* parents */}
        {detail.parents.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mt-1 text-[calc(var(--font-size)-2px)] text-text-muted">
            <span>Parent:</span>
            {detail.parents.map((p) => (
              <span key={p} className="font-mono text-accent-blue">
                {p.slice(0, 7)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Changed files header */}
      <div className="flex items-center gap-1.5 px-1 shrink-0">
        <span className="text-[var(--font-size)] text-text-secondary font-medium">
          Changed Files
        </span>
        <span className="text-[calc(var(--font-size)-2px)] text-text-muted">({files.length})</span>
      </div>

      {/* File list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {files.length === 0 ? (
          <div className="flex items-center justify-center py-4 text-[var(--font-size)] text-text-muted">
            No files changed
          </div>
        ) : (
          files.map((file) => {
            const statusInfo = STATUS_ICONS[file.status] ?? STATUS_ICONS.M;
            return (
              <div
                key={file.path}
                className="flex items-center gap-1.5 px-2 py-1 text-[var(--font-size)] hover:bg-bg-hover cursor-pointer transition-colors duration-100 group"
                onDoubleClick={() => handleDoubleClick(file.path)}
                title="Double-click to view diff"
              >
                <span className={statusInfo.color}>{statusInfo.icon}</span>
                <span className="flex-1 truncate text-text-primary font-mono text-[calc(var(--font-size)-1px)]">
                  {file.path}
                </span>
                <span className="flex items-center gap-0.5 shrink-0">
                  <span className="flex items-center gap-px text-accent-green">
                    <Plus size={9} />
                    <span className="text-[calc(var(--font-size)-2px)]">{file.additions}</span>
                  </span>
                  <span className="flex items-center gap-px text-accent-red">
                    <Minus size={9} />
                    <span className="text-[calc(var(--font-size)-2px)]">{file.deletions}</span>
                  </span>
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

function refsLabel(refs: string): string {
  const parts = refs.split(",").map((r) => r.trim()).filter(Boolean);
  const tags = parts.filter((r) => r.startsWith("tag:"));
  if (tags.length > 0)
    return `(${tags.map((t) => t.replace("tag: ", "")).join(", ")})`;
  const branches = parts.filter(
    (r) => !r.startsWith("tag:") && !r.startsWith("HEAD ->"),
  );
  if (branches.length > 0) return `(${branches[0]})`;
  return "";
}

function formatTimestamp(ts: string): string {
  try {
    const date = new Date(ts);
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

export default React.memo(CommitDetailPanel);

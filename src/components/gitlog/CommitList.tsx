import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { CommitEntry } from "../../types";
import type { CommitMenuAction } from "./types";
import CommitGraph, { ROW_HEIGHT } from "./CommitGraph";
import {
  Copy,
  MoreHorizontal,
  GitFork,
  Undo2,
  GitBranchPlus,
  Tag,
  SquareArrowOutUpRight,
  Check,
} from "lucide-react";
import { cn } from "../../utils/cn";

interface CommitListProps {
  commits: CommitEntry[];
  selectedHash: string | null;
  onSelectCommit: (hash: string) => void;
  onAction: (hash: string, action: CommitMenuAction, value?: string) => void;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
  searchQuery: string;
}


const CommitList: React.FC<CommitListProps> = ({
  commits,
  selectedHash,
  onSelectCommit,
  onAction,
  loading,
  hasMore,
  onLoadMore,
  loadingMore,
  searchQuery,
}) => {
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actionState, setActionState] = useState<{
    hash: string;
    action: "create-branch" | "create-tag";
  } | null>(null);
  const [inputValue, setInputValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 无限滚动
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) onLoadMore();
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const filteredCommits = useMemo(() => {
    if (!searchQuery.trim()) return commits;
    const q = searchQuery.toLowerCase();
    return commits.filter(
      (c) =>
        c.message.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q) ||
        c.short_hash.toLowerCase().includes(q),
    );
  }, [commits, searchQuery]);

  const handleActionClick = useCallback(
    (hash: string, action: CommitMenuAction) => {
      setMenuOpen(null);
      if (action === "create-branch" || action === "create-tag") {
        setActionState({ hash, action });
        setInputValue("");
        return;
      }
      onAction(hash, action);
    },
    [onAction],
  );

  const handleInputConfirm = useCallback(() => {
    if (!actionState || !inputValue.trim()) return;
    onAction(actionState.hash, actionState.action, inputValue.trim());
    setActionState(null);
    setInputValue("");
  }, [actionState, inputValue, onAction]);

  if (loading && commits.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--font-size)] text-text-muted">
        Loading...
      </div>
    );
  }

  if (filteredCommits.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--font-size)] text-text-muted">
        {searchQuery ? "No matching commits" : "No commits yet"}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="flex flex-row">
        {/* Graph 列 — @gitgraph/react 渲染的单个 SVG */}
        <CommitGraph
          commits={filteredCommits}
          selectedHash={selectedHash}
          onSelectCommit={onSelectCommit}
        />

        {/* Commit 信息列 — 无 paddingTop，由 CommitGraph 的 initCommitOffsetY 精确对齐 */}
        <div className="flex-1 min-w-0">
          {filteredCommits.map((commit) => {
            const isSelected = commit.hash === selectedHash;

            return (
              <div key={commit.hash} className="relative">
                 {/* 每行固定高度 ROW_HEIGHT，与 graph spacing 完全一致 */}
                 <div
                   className={cn(
                     "flex flex-col justify-center px-1 pr-1 cursor-pointer group transition-colors duration-100",
                     isSelected ? "bg-bg-selected" : "hover:bg-bg-hover",
                   )}
                   style={{ height: ROW_HEIGHT }}
                   onClick={() => onSelectCommit(commit.hash)}
                 >
                   {/* 第一行：type badge + subject + 操作按钮 */}
                   {(() => {
                     const { type, subject } = parseCommitMessage(commit.message);
                     const refs = commit.refs ? refsLabel(commit.refs) : "";
                     return (
                       <>
                         <div className="flex items-center gap-1 min-w-0">
                           {type && (
                             <span className={cn(
                               "shrink-0 text-[calc(var(--font-size)-3px)] font-medium px-1 py-px rounded leading-none",
                               typeStyle(type),
                             )}>
                               {type}
                             </span>
                           )}
                           <span className="flex-1 truncate text-[var(--font-size)] text-text-primary leading-tight">
                             {subject}
                           </span>
                           <button
                             className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover opacity-0 group-hover:opacity-100 shrink-0 transition-opacity duration-100"
                              title="Copy commit hash"
                             onClick={(e) => {
                               e.stopPropagation();
                               navigator.clipboard.writeText(commit.hash);
                             }}
                           >
                             <Copy size={10} />
                           </button>
                           <button
                             className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover opacity-0 group-hover:opacity-100 shrink-0 transition-opacity duration-100"
                              title="More actions"
                             onClick={(e) => {
                               e.stopPropagation();
                               setMenuOpen(menuOpen === commit.hash ? null : commit.hash);
                             }}
                           >
                             <MoreHorizontal size={10} />
                           </button>
                         </div>

                         {/* 第二行：作者 · 时间 + refs badge */}
                         <div className="flex items-center gap-1 min-w-0 mt-0.5">
                           <span className="text-[calc(var(--font-size)-2px)] text-text-muted truncate leading-tight" style={{ maxWidth: 80 }}>
                             {commit.author}
                           </span>
                           <span className="text-[calc(var(--font-size)-2px)] text-text-muted shrink-0 leading-tight">·</span>
                           <span className="text-[calc(var(--font-size)-2px)] text-text-muted shrink-0 leading-tight">
                             {formatTimestamp(commit.timestamp)}
                           </span>
                           {refs && (
                             <span className="ml-auto shrink-0 text-[calc(var(--font-size)-3px)] font-medium px-1 py-px rounded leading-none bg-accent-yellow/10 text-accent-yellow truncate" style={{ maxWidth: 80 }}>
                               {refs}
                             </span>
                           )}
                         </div>
                       </>
                     );
                   })()}
                 </div>

                {/* 右键菜单 */}
                {menuOpen === commit.hash && (
                  <div
                    ref={menuRef}
                    className="absolute right-2 top-10 z-50 w-36 bg-bg-secondary border border-border rounded-md shadow-lg py-0.5"
                  >
                    <MenuItem
                      icon={<GitFork size={11} />}
                      label="Cherry Pick"
                      onClick={() => handleActionClick(commit.hash, "cherry-pick")}
                    />
                    <MenuItem
                      icon={<Undo2 size={11} />}
                      label="Revert"
                      onClick={() => handleActionClick(commit.hash, "revert")}
                    />
                    <MenuItem
                      icon={<GitBranchPlus size={11} />}
                      label="Create Branch"
                      onClick={() => handleActionClick(commit.hash, "create-branch")}
                    />
                    <MenuItem
                      icon={<Tag size={11} />}
                      label="Create Tag"
                      onClick={() => handleActionClick(commit.hash, "create-tag")}
                    />
                    <MenuItem
                      icon={<SquareArrowOutUpRight size={11} />}
                      label="Checkout Detached"
                      onClick={() => handleActionClick(commit.hash, "checkout-detached")}
                    />
                  </div>
                )}

                {/* 创建 branch / tag 内联输入框 */}
                {actionState?.hash === commit.hash && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-tertiary mx-3 rounded mb-0.5">
                    <span className="text-[calc(var(--font-size)-2px)] text-text-muted shrink-0">
                      {actionState.action === "create-branch" ? "Branch:" : "Tag:"}
                    </span>
                    <input
                      type="text"
                      className="flex-1 bg-transparent border border-border rounded px-1.5 py-0.5 text-[var(--font-size)] text-text-primary outline-none focus:border-accent-blue"
                      placeholder={
                        actionState.action === "create-branch" ? "branch-name" : "v1.0.0"
                      }
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleInputConfirm();
                        if (e.key === "Escape") {
                          setActionState(null);
                          setInputValue("");
                        }
                      }}
                      autoFocus
                    />
                    <button
                      className="p-0.5 rounded text-text-muted hover:text-accent-green hover:bg-bg-hover transition-colors duration-100"
                      onClick={handleInputConfirm}
                      disabled={!inputValue.trim()}
                      title="Confirm"
                    >
                      <Check size={11} />
                    </button>
                    <button
                      className="p-0.5 rounded text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors duration-100 text-[calc(var(--font-size)-2px)]"
                      onClick={() => {
                        setActionState(null);
                        setInputValue("");
                      }}
                      title="Cancel"
                    >
                      ESC
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* 无限滚动哨兵 */}
          {hasMore && (
            <div ref={sentinelRef} className="py-2 text-center text-[var(--font-size)] text-text-muted">
              {loadingMore ? "Loading more..." : ""}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex items-center gap-1.5 w-full px-2 py-1 text-[var(--font-size)] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors duration-100"
      onClick={onClick}
    >
      <span className="text-text-muted shrink-0">{icon}</span>
      {label}
    </button>
  );
}

/**
 * 解析 Conventional Commits 格式：type(scope): subject
 * 返回 type（如 feat/fix/refactor）和 subject（第一行去掉 type 前缀）
 */
function parseCommitMessage(message: string): { type: string; subject: string } {
  const header = message.split("\n")[0].trim();
  const m = header.match(/^(\w+)(?:\([^)]*\))?!?:\s*(.+)/);
  if (m) return { type: m[1], subject: m[2] };
  return { type: "", subject: header };
}

/** type badge 的颜色样式（Tailwind 类） */
function typeStyle(type: string): string {
  switch (type) {
    case "feat":
      return "bg-accent-blue/15 text-accent-blue";
    case "fix":
      return "bg-accent-red/15 text-accent-red";
    case "perf":
      return "bg-accent-green/15 text-accent-green";
    default:
      // refactor / chore / docs / style / test / build / ci / revert / etc.
      return "bg-bg-tertiary text-text-muted";
  }
}

function refsLabel(refs: string): string {
  const parts = refs.split(",").map((r) => r.trim()).filter(Boolean);
  // HEAD → branch 优先
  for (const p of parts) {
    const arrow = p.match(/HEAD\s*->\s*(.+)/);
    if (arrow) return arrow[1].trim();
  }
  // tag
  const tags = parts.filter((r) => r.startsWith("tag:"));
  if (tags.length > 0)
    return tags.map((t) => t.replace("tag:", "").trim()).join(", ");
  // 其他 branch（排除 origin/...）
  const local = parts.filter((r) => !r.startsWith("tag:") && !r.includes("/"));
  if (local.length > 0) return local[0];
  // remote
  const remote = parts.filter((r) => !r.startsWith("tag:"));
  if (remote.length > 0) return remote[0];
  return "";
}

/** 格式化时间为 YYYY/MM/DD HH:mm */
function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, "0");
    const D = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${Y}/${M}/${D} ${h}:${m}`;
  } catch {
    return ts;
  }
}

export default React.memo(CommitList);

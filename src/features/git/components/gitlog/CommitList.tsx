import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { CommitEntry, CommitDetail, CommitFileChange } from "@/features/git/types";
import CommitGraph, { computeLayout, ROW_HEIGHT, BRANCH_SPACING, NODE_RADIUS } from "./CommitGraph";
import {
  Copy,
  MoreHorizontal,
  GitFork,
  Undo2,
  GitBranchPlus,
  Tag,
  SquareArrowOutUpRight,
  Plus,
  Minus,
  FilePlus,
  Pencil,
  Trash2,
  FileText,
  GitCommitHorizontal,
} from "@/shared/components/icons"
import { cn } from '@/lib/utils';

interface CommitListProps {
  commits: CommitEntry[];
  selectedHash: string | null;
  selectedExpanded: boolean;
  detail: CommitDetail | null;
  files: CommitFileChange[];
  detailLoading: boolean;
  detailError: string | null;
  onSelectCommit: (hash: string) => void;
  onOpenDiff: (filePath: string) => void;
  onPinFile: (filePath: string) => void;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
  searchQuery: string;
}

const STATUS_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  M: { icon: <Pencil size={10} />, color: "text-accent-blue" },
  A: { icon: <FilePlus size={10} />, color: "text-accent-green" },
  D: { icon: <Trash2 size={10} />, color: "text-accent-red" },
  R: { icon: <FileText size={10} />, color: "text-accent-orange" },
};

const CommitList: React.FC<CommitListProps> = ({
  commits,
  selectedHash,
  selectedExpanded,
  detail,
  files,
  detailLoading,
  detailError,
  onSelectCommit,
  onOpenDiff,
  onPinFile,
  loading,
  hasMore,
  onLoadMore,
  loadingMore,
  searchQuery,
}) => {
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Infinite scroll
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

  // Close menu on outside click
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

  const { maxColUsed, dotXByRow } = useMemo(() => {
    const layout = computeLayout(filteredCommits);
    return {
      maxColUsed: layout.maxColUsed,
      dotXByRow: layout.nodes.map((n) => n.x * BRANCH_SPACING + NODE_RADIUS * 2),
    };
  }, [filteredCommits]);

  // 每行 SVG 宽度 = 最右列右边缘 + padding
  const rowGraphWidth = (maxColUsed + 1) * BRANCH_SPACING + NODE_RADIUS * 4 + 2;

  const handleRowClick = useCallback(
    (hash: string, e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest(".commit-expand")) return;
      onSelectCommit(hash);
    },
    [onSelectCommit],
  );

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
    <div className="h-full overflow-auto">
      <div className="relative min-w-min">
        {/* ── 完整 SVG 背景层（线不断裂） ── */}
        <div className="absolute left-0 top-0 shrink-0 pointer-events-none z-10" style={{ width: rowGraphWidth }}>
          <CommitGraph
            commits={filteredCommits}
            selectedHash={selectedHash}
            onSelectCommit={onSelectCommit}
            hoveredHash={hoveredHash}
          />
        </div>
        {/* ── 文字层，每行 paddingLeft = dot 右边缘 + 小间距 ── */}
        <div>
          {filteredCommits.map((commit, rowIdx) => {
            const isSelected = commit.hash === selectedHash;
            const isExpanded = isSelected && selectedExpanded;
            const dotX = dotXByRow[rowIdx] ?? NODE_RADIUS * 2;
            const textLeft = dotX + NODE_RADIUS + 4; // 紧跟 dot 右边缘

            return (
              <div key={commit.hash} className="relative"
                onMouseEnter={() => setHoveredHash(commit.hash)}
                onMouseLeave={() => setHoveredHash(null)}
              >
                <div
                  className={cn(
                    "flex flex-col justify-center pr-1 cursor-pointer group transition-colors duration-100",
                    isExpanded ? "bg-bg-selected" : isSelected ? "bg-bg-selected/70" : "hover:bg-bg-hover",
                  )}
                  style={{ height: ROW_HEIGHT, paddingLeft: textLeft }}
                  onClick={(e) => handleRowClick(commit.hash, e)}
                >
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

                {/* ── Inline expanded detail ── */}
                {isExpanded && (
                  <div className="commit-expand pl-6 pr-2 pb-2 pt-1 border-l-2 border-accent-blue/40 ml-1 bg-bg-tertiary/20">
                    {detailLoading ? (
                      <div className="text-[var(--font-size)] text-text-muted py-2">Loading...</div>
                    ) : detailError ? (
                      <div className="text-[var(--font-size)] text-accent-red py-2">{detailError}</div>
                    ) : detail ? (
                      <>
                        <div className="flex items-center gap-1.5 mb-1">
                          <GitCommitHorizontal size={12} className="text-text-muted shrink-0" />
                          <span className="text-[var(--font-size)] font-mono text-accent-blue">{detail.short_hash}</span>
                          <span className={cn(
                            "text-[calc(var(--font-size)-3px)] font-medium px-1 py-px rounded leading-none",
                            typeStyle(parseCommitMessage(detail.message).type),
                          )}>
                            {parseCommitMessage(detail.message).type || "commit"}
                          </span>
                          {detail.refs && (
                            <span className="text-[calc(var(--font-size)-3px)] font-medium px-1 py-px rounded bg-accent-yellow/10 text-accent-yellow truncate max-w-[100px]">
                              {refsLabel(detail.refs)}
                            </span>
                          )}
                        </div>
                        <div className="text-[var(--font-size)] font-medium text-text-primary mb-1 leading-snug">
                          {parseCommitMessage(detail.message).subject || detail.message.split("\n")[0]}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[calc(var(--font-size)-2px)] text-text-muted mb-1">
                          <span className="font-medium text-text-secondary">{detail.author}</span>
                          <span>·</span>
                          <span>{formatTimestamp(detail.timestamp)}</span>
                          <span>·</span>
                          <span>parents: {detail.parents.map((p) => p.slice(0, 7)).join(", ") || "—"}</span>
                        </div>
                        <div className="border-t border-border/50 pt-1 mt-1">
                          {files.map((f) => {
                            const statusInfo = STATUS_ICONS[f.status] ?? STATUS_ICONS.M;
                            return (
                              <div
                                key={f.path}
                                className="flex items-center gap-1.5 px-1 py-0.5 rounded cursor-pointer hover:bg-bg-hover transition-colors duration-100 group"
                                onClick={(e) => { e.stopPropagation(); onOpenDiff(f.path); }}
                                onDoubleClick={(e) => { e.stopPropagation(); onPinFile(f.path); }}
                                title="Click: view diff · Double-click: pin file"
                              >
                                <span className={statusInfo.color + " shrink-0"}>{statusInfo.icon}</span>
                                <span className="flex-1 truncate text-[calc(var(--font-size)-1px)] font-mono text-text-primary">
                                  {f.path}
                                </span>
                                <span className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                                  <span className="flex items-center gap-px text-accent-green">
                                    <Plus size={9} />
                                    <span className="text-[calc(var(--font-size)-2px)]">{f.additions}</span>
                                  </span>
                                  <span className="flex items-center gap-px text-accent-red">
                                    <Minus size={9} />
                                    <span className="text-[calc(var(--font-size)-2px)]">{f.deletions}</span>
                                  </span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="text-[var(--font-size)] text-text-muted py-1">No details</div>
                    )}
                  </div>
                )}

                {/* Context menu */}
                {menuOpen === commit.hash && (
                  <div
                    ref={menuRef}
                    className="absolute right-2 z-50 w-36 bg-bg-secondary border border-border rounded-md shadow-lg py-0.5"
                    style={{ top: ROW_HEIGHT }}
                  >
                    <MenuItem icon={<GitFork size={11} />} label="Cherry Pick" />
                    <MenuItem icon={<Undo2 size={11} />} label="Revert" />
                    <MenuItem icon={<GitBranchPlus size={11} />} label="Create Branch" />
                    <MenuItem icon={<Tag size={11} />} label="Create Tag" />
                    <MenuItem icon={<SquareArrowOutUpRight size={11} />} label="Checkout Detached" />
                  </div>
                )}
              </div>
            );
          })}

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

function MenuItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="flex items-center gap-1.5 w-full px-2 py-1 text-[var(--font-size)] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors duration-100">
      <span className="text-text-muted shrink-0">{icon}</span>
      {label}
    </button>
  );
}

function parseCommitMessage(message: string): { type: string; subject: string } {
  const header = message.split("\n")[0].trim();
  const m = header.match(/^(\w+)(?:\([^)]*\))?!?:\s*(.+)/);
  if (m) return { type: m[1], subject: m[2] };
  return { type: "", subject: header };
}

function typeStyle(type: string): string {
  switch (type) {
    case "feat": return "bg-accent-blue/15 text-accent-blue";
    case "fix": return "bg-accent-red/15 text-accent-red";
    case "perf": return "bg-accent-green/15 text-accent-green";
    default: return "bg-bg-tertiary text-text-muted";
  }
}

function refsLabel(refs: string): string {
  const parts = refs.split(",").map((r) => r.trim()).filter(Boolean);
  for (const p of parts) {
    const arrow = p.match(/HEAD\s*->\s*(.+)/);
    if (arrow) return arrow[1].trim();
  }
  const tags = parts.filter((r) => r.startsWith("tag:"));
  if (tags.length > 0) return tags.map((t) => t.replace("tag:", "").trim()).join(", ");
  const local = parts.filter((r) => !r.startsWith("tag:") && !r.includes("/"));
  if (local.length > 0) return local[0];
  const remote = parts.filter((r) => !r.startsWith("tag:"));
  if (remote.length > 0) return remote[0];
  return "";
}

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
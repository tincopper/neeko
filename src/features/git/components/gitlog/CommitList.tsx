import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { CommitEntry, CommitDetail, CommitFileChange } from "@/features/git/types";
import CommitGraph, {
  computeLayout,
  ROW_HEIGHT,
  BRANCH_SPACING,
  NODE_RADIUS,
} from "./CommitGraph";
import {
  parseCommitMessage,
  commitBodyPreview,
  typeStyle,
  formatRefs,
  formatAbsoluteTime,
  formatRelativeTime,
  graphWidthForCols,
  textLeftForCol,
  splitFilePath,
} from "./commitListUtils";
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
} from "@/shared/components/icons";
import { cn } from "@/lib/utils";

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
  focusedFileIndex?: number;
  onClearSearch?: () => void;
}

/** Expand panel max height — keeps list jump bounded and graph offset predictable. */
const EXPAND_MAX_HEIGHT = 280;

const STATUS_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  M: { icon: <Pencil size={11} />, color: "text-accent-blue" },
  A: { icon: <FilePlus size={11} />, color: "text-accent-green" },
  D: { icon: <Trash2 size={11} />, color: "text-accent-red" },
  R: { icon: <FileText size={11} />, color: "text-accent-orange" },
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
  focusedFileIndex = -1,
  onClearSearch,
}) => {
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  const [expandHeight, setExpandHeight] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const expandRef = useRef<HTMLDivElement>(null);
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

  // Measure expand height so graph below selected row can translateY
  useEffect(() => {
    if (!selectedExpanded || !selectedHash) {
      setExpandHeight(0);
      return;
    }
    const el = expandRef.current;
    if (!el) {
      setExpandHeight(0);
      return;
    }
    const measure = () => setExpandHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [selectedExpanded, selectedHash, detail, files, detailLoading, detailError]);

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

  const selectedRowIndex = useMemo(() => {
    if (!selectedHash || !selectedExpanded) return -1;
    return filteredCommits.findIndex((c) => c.hash === selectedHash);
  }, [filteredCommits, selectedHash, selectedExpanded]);

  const { maxColUsed, textLeftByHash } = useMemo(() => {
    const layout = computeLayout(filteredCommits);
    const leftMap = new Map<string, number>();
    for (const node of layout.nodes) {
      leftMap.set(node.hash, textLeftForCol(node.x, BRANCH_SPACING, NODE_RADIUS));
    }
    return { maxColUsed: layout.maxColUsed, textLeftByHash: leftMap };
  }, [filteredCommits]);

  // Graph overlay width (may be wider than any single row's text inset).
  const { fullWidth: rowGraphFullWidth, visibleWidth: rowGraphWidth } = useMemo(
    () => graphWidthForCols(maxColUsed, BRANCH_SPACING, NODE_RADIUS),
    [maxColUsed],
  );

  const fileStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const f of files) {
      additions += f.additions;
      deletions += f.deletions;
    }
    return { additions, deletions, count: files.length };
  }, [files]);

  const handleRowClick = useCallback(
    (hash: string, e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest(".commit-expand")) return;
      onSelectCommit(hash);
    },
    [onSelectCommit],
  );

  if (loading && commits.length === 0) {
    return (
      <div className="h-full overflow-hidden px-1 py-1 space-y-1" aria-busy="true" aria-label="Loading">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 h-8 animate-pulse">
            <div className="w-2 h-2 rounded-full bg-bg-tertiary shrink-0" />
            <div className="flex-1 space-y-1.5 min-w-0">
              <div className="h-2.5 rounded bg-bg-tertiary w-[75%]" />
              <div className="h-2 rounded bg-bg-tertiary/70 w-[40%]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (filteredCommits.length === 0) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center gap-2 text-[var(--font-size)] text-text-muted px-3">
        <span>{searchQuery ? "No matching commits" : "No commits yet"}</span>
        {searchQuery && onClearSearch ? (
          <button
            type="button"
            className="text-accent-blue hover:underline text-[calc(var(--font-size)-1px)]"
            onClick={onClearSearch}
          >
            Clear filter
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {/* w-full + min-w-0 so long paths truncate instead of expanding the panel */}
      <div className="relative w-full min-w-0">
        {/* Graph above row backgrounds so hover/selection never covers dots */}
        <div
          className="absolute left-0 top-0 shrink-0 z-30 overflow-x-auto overflow-y-hidden pointer-events-none"
          style={{ width: rowGraphWidth }}
        >
          <div style={{ width: rowGraphFullWidth }}>
            <CommitGraph
              commits={filteredCommits}
              selectedHash={selectedHash}
              onSelectCommit={onSelectCommit}
              hoveredHash={hoveredHash}
              expandAfterRow={selectedRowIndex}
              expandOffsetY={expandHeight}
            />
          </div>
        </div>

        <div className="min-w-0">
          {filteredCommits.map((commit) => {
            const isSelected = commit.hash === selectedHash;
            const isExpanded = isSelected && selectedExpanded;
            const { type, scope, subject, header } = parseCommitMessage(commit.message);
            const refs = commit.refs ? formatRefs(commit.refs) : null;
            const absTime = formatAbsoluteTime(commit.timestamp);
            const relTime = formatRelativeTime(commit.timestamp);
            // Text hugs this row's own dot — not the full multi-lane graph width.
            const textLeft =
              textLeftByHash.get(commit.hash) ?? textLeftForCol(0, BRANCH_SPACING, NODE_RADIUS);

            const isHovered = hoveredHash === commit.hash;

            return (
              <div key={commit.hash} className="relative min-w-0">
                <div
                  className={cn(
                    "relative z-10 flex flex-col justify-center pr-2 cursor-pointer group transition-colors duration-100 min-w-0",
                    // Hover/selection only on the commit row — not the expand panel below.
                    isExpanded
                      ? "bg-bg-selected"
                      : isSelected
                        ? "bg-bg-selected/70"
                        : isHovered
                          ? "bg-bg-hover"
                          : undefined,
                  )}
                  style={{ height: ROW_HEIGHT, paddingLeft: textLeft }}
                  onMouseEnter={() => setHoveredHash(commit.hash)}
                  onMouseLeave={() => setHoveredHash(null)}
                  onClick={(e) => handleRowClick(commit.hash, e)}
                >
                  <div className="flex items-center gap-1 min-w-0">
                    {type ? (
                      <span
                        className={cn(
                          "shrink-0 max-w-[10rem] truncate text-[calc(var(--font-size)-3px)] font-medium px-1 py-px rounded leading-none",
                          typeStyle(type),
                        )}
                        title={scope ? `${type}(${scope})` : type}
                      >
                        {scope ? `${type}(${scope})` : type}
                      </span>
                    ) : null}
                    <span
                      className="flex-1 truncate text-[var(--font-size)] text-text-primary leading-tight"
                      title={header}
                    >
                      {subject}
                    </span>
                    <button
                      type="button"
                      className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover opacity-0 group-hover:opacity-100 shrink-0 transition-opacity duration-100"
                      title="Copy full hash"
                      onClick={(e) => {
                        e.stopPropagation();
                        void navigator.clipboard.writeText(commit.hash);
                      }}
                    >
                      <Copy size={10} />
                    </button>
                    <button
                      type="button"
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
                    <span
                      className="text-[calc(var(--font-size)-2px)] text-text-muted truncate leading-tight"
                      style={{ maxWidth: 72 }}
                      title={commit.author}
                    >
                      {commit.author}
                    </span>
                    <span className="text-[calc(var(--font-size)-2px)] text-text-muted shrink-0 leading-tight">
                      ·
                    </span>
                    <span
                      className="text-[calc(var(--font-size)-2px)] text-text-muted shrink-0 leading-tight"
                      title={absTime}
                    >
                      {relTime}
                    </span>
                    <span className="text-[calc(var(--font-size)-2px)] text-text-muted shrink-0 leading-tight">
                      ·
                    </span>
                    <span
                      className="text-[calc(var(--font-size)-2px)] font-mono text-text-muted shrink-0 leading-tight"
                      title={commit.hash}
                    >
                      {commit.short_hash}
                    </span>
                    {refs ? (
                      <span
                        className="ml-auto shrink-0 text-[calc(var(--font-size)-3px)] font-medium px-1 py-px rounded leading-none bg-accent-yellow/10 text-accent-yellow truncate max-w-[96px]"
                        title={refs.title}
                      >
                        {refs.primary}
                        {refs.extraCount > 0 ? ` +${refs.extraCount}` : ""}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Inline expanded detail — files-first, max-height scroll */}
                {isExpanded ? (
                  <div
                    ref={expandRef}
                    className="commit-expand relative z-10 mr-1 mt-0.5 mb-0.5 rounded-md border border-border/40 bg-bg-tertiary/40 min-w-0 overflow-hidden"
                    style={{ marginLeft: Math.max(textLeft - 2, 4) }}
                  >
                    {detailLoading ? (
                      <div className="text-[var(--font-size)] text-text-muted px-3 py-2">Loading details…</div>
                    ) : detailError ? (
                      <div className="text-[var(--font-size)] text-accent-red px-3 py-2">{detailError}</div>
                    ) : detail ? (
                      <div
                        className="px-2.5 py-2"
                        style={{ maxHeight: EXPAND_MAX_HEIGHT, overflowY: "auto" }}
                      >
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mb-1 text-[calc(var(--font-size)-1px)]">
                          <span className="font-mono text-accent-blue">{detail.short_hash}</span>
                          <span className="text-text-muted">·</span>
                          <span className="text-text-muted">
                            parents:{" "}
                            {detail.parents.map((p) => p.slice(0, 7)).join(", ") || "—"}
                          </span>
                        </div>
                        {commitBodyPreview(detail.message) ? (
                          <p className="text-[calc(var(--font-size)-2px)] text-text-secondary leading-snug mb-1.5 whitespace-pre-wrap line-clamp-2">
                            {commitBodyPreview(detail.message)}
                          </p>
                        ) : null}
                        <div className="flex items-center gap-2 text-[calc(var(--font-size)-2px)] text-text-muted mb-1 border-t border-border/40 pt-1">
                          <span>
                            {fileStats.count} {fileStats.count === 1 ? "file" : "files"}
                          </span>
                          <span className="flex items-center gap-px text-accent-green">
                            <Plus size={9} />
                            {fileStats.additions}
                          </span>
                          <span className="flex items-center gap-px text-accent-red">
                            <Minus size={9} />
                            {fileStats.deletions}
                          </span>
                        </div>
                        <div>
                          {files.map((f, idx) => {
                            const statusInfo = STATUS_ICONS[f.status] ?? STATUS_ICONS.M;
                            const isFocused = idx === focusedFileIndex;
                            const { name, dir } = splitFilePath(f.path);
                            return (
                              <div
                                key={f.path}
                                className={cn(
                                  "grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-1.5 px-1.5 py-1 rounded cursor-pointer min-w-0 w-full",
                                  // Keyboard focus only — no hover wash on file rows.
                                  isFocused && "bg-bg-hover/60",
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenDiff(f.path);
                                }}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  onPinFile(f.path);
                                }}
                                title={`${f.path}  +${f.additions} −${f.deletions}\nClick: open diff · Double-click: pin tab`}
                              >
                                <span className={cn(statusInfo.color, "shrink-0")}>{statusInfo.icon}</span>
                                {/* filename keeps priority; only dir column shrinks with ellipsis */}
                                <span className="truncate max-w-[9rem] text-[calc(var(--font-size)-1px)] font-mono text-text-primary">
                                  {name}
                                </span>
                                <span
                                  className={cn(
                                    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[calc(var(--font-size)-3px)] font-mono text-text-muted",
                                    !dir && "invisible",
                                  )}
                                >
                                  {dir || "—"}
                                </span>
                                <span className="flex items-center gap-1 justify-end tabular-nums">
                                  <span className="flex items-center gap-px text-accent-green whitespace-nowrap">
                                    <Plus size={9} />
                                    <span className="text-[calc(var(--font-size)-2px)]">{f.additions}</span>
                                  </span>
                                  <span className="flex items-center gap-px text-accent-red whitespace-nowrap">
                                    <Minus size={9} />
                                    <span className="text-[calc(var(--font-size)-2px)]">{f.deletions}</span>
                                  </span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-1 text-[calc(var(--font-size)-3px)] text-text-muted leading-tight">
                          Click open · Double-click pin · J/K commits · j/k files
                        </div>
                      </div>
                    ) : (
                      <div className="text-[var(--font-size)] text-text-muted px-3 py-2">No details</div>
                    )}
                  </div>
                ) : null}

                {menuOpen === commit.hash ? (
                  <div
                    ref={menuRef}
                    className="absolute right-2 z-50 w-40 bg-bg-secondary border border-border rounded-md shadow-lg py-0.5"
                    style={{ top: ROW_HEIGHT }}
                  >
                    <MenuItem icon={<GitFork size={11} />} label="Cherry Pick" disabled />
                    <MenuItem icon={<Undo2 size={11} />} label="Revert" disabled />
                    <MenuItem icon={<GitBranchPlus size={11} />} label="Create Branch" disabled />
                    <MenuItem icon={<Tag size={11} />} label="Create Tag" disabled />
                    <MenuItem icon={<SquareArrowOutUpRight size={11} />} label="Checkout Detached" disabled />
                    <div className="px-2 py-1 text-[calc(var(--font-size)-3px)] text-text-muted border-t border-border/40 mt-0.5">
                      Coming soon
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}

          {hasMore ? (
            <div ref={sentinelRef} className="py-2 text-center text-[var(--font-size)] text-text-muted">
              {loadingMore ? "Loading more…" : ""}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

function MenuItem({
  icon,
  label,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? "Coming soon" : undefined}
      className={cn(
        "flex items-center gap-1.5 w-full px-2 py-1 text-[var(--font-size)] transition-colors duration-100",
        disabled
          ? "text-text-muted/60 cursor-not-allowed"
          : "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
      )}
    >
      <span className="text-text-muted shrink-0">{icon}</span>
      {label}
    </button>
  );
}

export default React.memo(CommitList);

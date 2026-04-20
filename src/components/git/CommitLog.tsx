import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { Search, Filter, X, ChevronDown } from "lucide-react";
import type { CommitInfo } from "../../types";
import CommitGraph from "./CommitGraph";

interface CommitLogProps {
  commits: CommitInfo[];
  selectedHash: string | null;
  loading: boolean;
  searchQuery: string;
  selectedBranch: string | null;
  onSearchChange: (query: string) => void;
  onSelectCommit: (hash: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
}

interface CommitRowProps {
  commit: CommitInfo;
  isSelected: boolean;
  onSelect: (hash: string) => void;
}

function CommitRow({ commit, isSelected, onSelect }: CommitRowProps) {
  const handleClick = useCallback(() => onSelect(commit.hash), [onSelect, commit.hash]);

  return (
    <div
      className={`flex items-start gap-2 px-2 py-[5px] cursor-pointer
        ${isSelected ? "bg-accent/15" : "hover:bg-bg-hover"}
      `}
      onClick={handleClick}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[var(--font-size)] text-text-primary truncate font-medium">
          {commit.message}
        </div>
        <div className="flex items-center gap-2 text-[calc(var(--font-size)-1px)] text-text-muted mt-[1px]">
          <span className="font-mono text-accent">{commit.short_hash}</span>
          <span>{commit.author}</span>
          <span>{formatRelativeTime(commit.timestamp)}</span>
        </div>
      </div>
    </div>
  );
}

const MemoizedCommitRow = React.memo(CommitRow);

function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

type DateRange = "all" | "today" | "week" | "month";

function getDateRangeStart(range: DateRange): number {
  const now = new Date();
  switch (range) {
    case "today":
      now.setHours(0, 0, 0, 0);
      return Math.floor(now.getTime() / 1000);
    case "week":
      return Math.floor((Date.now() - 7 * 86400 * 1000) / 1000);
    case "month":
      return Math.floor((Date.now() - 30 * 86400 * 1000) / 1000);
    case "all":
    default:
      return 0;
  }
}

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  all: "All Time",
  today: "Today",
  week: "Last 7 Days",
  month: "Last 30 Days",
};

function FilterDropdown({
  label,
  options,
  selectedValue,
  onSelect,
}: {
  label: string;
  options: { value: string; label: string }[];
  selectedValue: string;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selectedLabel = options.find((o) => o.value === selectedValue)?.label ?? label;
  const isActive = selectedValue !== options[0]?.value;

  return (
    <div className="relative" ref={ref}>
      <button
        className={`flex items-center gap-1 px-2 py-[3px] rounded text-[calc(var(--font-size)-1px)] border transition-colors
          ${isActive ? "border-accent/50 text-accent bg-accent/10" : "border-border text-text-secondary hover:bg-bg-hover"}
        `}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{isActive ? selectedLabel : label}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[140px] rounded-md border border-border bg-bg-secondary shadow-lg py-1">
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`px-3 py-1.5 text-[calc(var(--font-size)-1px)] cursor-pointer hover:bg-bg-hover
                ${opt.value === selectedValue ? "text-accent" : "text-text-primary"}
              `}
              onClick={() => {
                onSelect(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommitLog({
  commits,
  selectedHash,
  loading,
  searchQuery,
  selectedBranch,
  onSearchChange,
  onSelectCommit,
  onLoadMore,
  hasMore,
}: CommitLogProps) {
  // Filter state
  const [authorFilter, setAuthorFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateRange>("all");

  // Extract unique authors from commits
  const authors = useMemo(() => {
    const unique = new Map<string, string>();
    for (const c of commits) {
      if (!unique.has(c.author)) {
        unique.set(c.author, c.author);
      }
    }
    return Array.from(unique.values()).sort();
  }, [commits]);

  const authorOptions = useMemo(() => [
    { value: "all", label: "All Authors" },
    ...authors.map((a) => ({ value: a, label: a })),
  ], [authors]);

  const dateOptions = useMemo(() => (
    (Object.entries(DATE_RANGE_LABELS) as [DateRange, string][]).map(([value, label]) => ({
      value,
      label,
    }))
  ), []);

  const hasActiveFilters = authorFilter !== "all" || dateFilter !== "all" || selectedBranch !== null;

  const handleClearFilters = useCallback(() => {
    setAuthorFilter("all");
    setDateFilter("all");
  }, []);

  // Apply filters
  const filteredCommits = useMemo(() => {
    let result = commits;

    // Text search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.message.toLowerCase().includes(q) ||
          c.hash.includes(searchQuery) ||
          c.short_hash.includes(searchQuery) ||
          c.author.toLowerCase().includes(q)
      );
    }

    // Author filter
    if (authorFilter !== "all") {
      result = result.filter((c) => c.author === authorFilter);
    }

    // Date filter
    if (dateFilter !== "all") {
      const start = getDateRangeStart(dateFilter);
      result = result.filter((c) => c.timestamp >= start);
    }

    return result;
  }, [commits, searchQuery, authorFilter, dateFilter]);

  return (
    <div className="flex flex-col h-full border-r border-border">
      {/* Search bar */}
      <div className="px-2 py-2 border-b border-border">
        <div className="flex items-center gap-1 bg-bg-secondary rounded px-2 py-1">
          <Search size={14} className="text-text-muted shrink-0" />
          <input
            className="flex-1 bg-transparent text-[var(--font-size)] text-text-primary placeholder-text-muted outline-none"
            placeholder="Text or hash"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border">
        <Filter size={12} className="text-text-muted shrink-0" />
        <FilterDropdown
          label="Author"
          options={authorOptions}
          selectedValue={authorFilter}
          onSelect={(v) => setAuthorFilter(v)}
        />
        <FilterDropdown
          label="Date"
          options={dateOptions}
          selectedValue={dateFilter}
          onSelect={(v) => setDateFilter(v as DateRange)}
        />
        {hasActiveFilters && (
          <button
            className="ml-auto p-[2px] rounded hover:bg-bg-hover text-text-muted hover:text-text-secondary"
            onClick={handleClearFilters}
            title="Clear filters"
          >
            <X size={12} />
          </button>
        )}
        {selectedBranch && (
          <span className="text-[calc(var(--font-size)-2px)] text-accent truncate max-w-[100px]" title={selectedBranch}>
            {selectedBranch.replace(/^origin\//, "")}
          </span>
        )}
      </div>

      {/* Commit list */}
      <div className="flex-1 overflow-y-auto">
        {filteredCommits.length === 0 && !loading ? (
          <div className="px-3 py-8 text-center text-text-muted text-[var(--font-size)]">
            {searchQuery || hasActiveFilters ? "No matching commits" : "No commits"}
          </div>
        ) : (
          <div className="flex">
            {/* Graph column */}
            {!searchQuery && !hasActiveFilters && (
              <CommitGraph commits={filteredCommits} currentHash={selectedHash ?? ""} />
            )}
            {/* Commit rows */}
            <div className="flex-1 min-w-0 border-l border-border/30">
              {filteredCommits.map((commit) => (
                <MemoizedCommitRow
                  key={commit.hash}
                  commit={commit}
                  isSelected={commit.hash === selectedHash}
                  onSelect={onSelectCommit}
                />
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="px-3 py-4 text-center text-text-muted text-[var(--font-size)]">
            Loading...
          </div>
        )}

        {hasMore && !loading && !searchQuery && !hasActiveFilters && (
          <button
            className="w-full px-3 py-2 text-[var(--font-size)] text-accent hover:bg-bg-hover"
            onClick={onLoadMore}
          >
            Load More
          </button>
        )}
      </div>
    </div>
  );
}

export default React.memo(CommitLog);

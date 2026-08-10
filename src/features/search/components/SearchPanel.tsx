import { ChevronDown, ChevronRight, Loader2, Search, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef } from 'react';

import { openProjectFile } from '@/features/quick-open/openFile';
import { useSearch } from '@/features/search/hooks/useSearch';
import { useSearchStore } from '@/features/search/store/searchStore';
import { useAppContext } from '@/shared/contexts';
import type { SearchMatch } from '@/shared/types/search';
import { fileIconSrc } from '@/shared/utils/fileIcons';

interface SearchPanelProps {
  projectId: string | null;
}

/** Highlight matched substrings within a line. */
function highlightMatch(line: string, query: string): React.ReactNode {
  if (!query) return line;
  const idx = line.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return line;
  const before = line.slice(0, idx);
  const match = line.slice(idx, idx + query.length);
  const after = line.slice(idx + query.length);
  return (
    <>
      {before}
      <span className="rounded bg-accent-yellow/25 px-0.5 text-foreground">{match}</span>
      {after}
    </>
  );
}

/**
 * Dock panel for searching file contents across the active project.
 *
 * Results are grouped by file and clickable — clicking a match opens the file
 * in the editor at the exact line/column. Pagination is appended via scroll.
 */
export const SearchPanel: React.FC<SearchPanelProps> = React.memo(({ projectId }) => {
  const { showToast } = useAppContext();
  const {
    query,
    setQuery,
    committed,
    fileGroups,
    fileNameMatches,
    status,
    truncated,
    clear,
    totalMatches,
  } = useSearch(projectId, showToast);

  const next = useSearchStore((s) => s.next);
  const collapsed = useSearchStore((s) => s.collapsed);
  const toggleCollapse = useSearchStore((s) => s.toggleCollapse);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoLoadedRef = useRef(false);

  // Auto-focus the input when the panel mounts.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hasMore = useSearchStore((s) => !s.truncated && s.offset > 0);
  const cursorOffset = useSearchStore((s) => s.offset);

  const handleOpenMatch = useCallback(
    (path: string, line: number, column: number) => {
      if (!projectId) return;
      void openProjectFile({ projectId, filePath: path, line, column });
    },
    [projectId],
  );

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || !projectId) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      void next(projectId);
    }
  }, [next, projectId]);

  // Auto-scroll request next page when the list grows shorter than viewport.
  useEffect(() => {
    if (!hasMore || !projectId) return;
    const el = listRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight) {
      if (!autoLoadedRef.current) {
        autoLoadedRef.current = true;
        void next(projectId);
      }
    } else {
      autoLoadedRef.current = false;
    }
  }, [fileGroups, hasMore, next, projectId, cursorOffset]);

  const fileCount = fileGroups.length;

  // Separate file name matches from content matches for status bar.
  const fileNameMatchCount = fileNameMatches.length;

  return (
    <div className="flex h-full flex-col">
      {/* Search Input */}
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Search className="size-3.5 shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files…"
            className="flex-1 bg-transparent text-[var(--font-size)] text-text-primary outline-none placeholder:text-text-muted"
            aria-label="Search project files"
          />
          {query && (
            <span className="text-[calc(var(--font-size)-1px)] text-text-muted px-1 shrink-0">
              {totalMatches} result{totalMatches !== 1 ? 's' : ''}
            </span>
          )}
          {query && (
            <button
              type="button"
              onClick={() => {
                clear();
              }}
              className="shrink-0 rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto scrollbar-thin">
        {status === 'running' && fileGroups.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-6 text-[var(--font-size)] text-text-muted">
            <Loader2 className="size-3.5 animate-spin" />
            Searching…
          </div>
        )}

        {status === 'idle' && !committed && (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-text-muted">
            <Search className="size-6 opacity-40" />
            <span className="text-[var(--font-size)]">Type to search across project files.</span>
          </div>
        )}

        {committed && status !== 'running' && fileGroups.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-text-muted">
            <Search className="size-6 opacity-40" />
            <span className="text-[var(--font-size)]">No matches found.</span>
          </div>
        )}

        {fileGroups.map((group) => {
          const iconSrc = fileIconSrc(group.path);
          const fileName = group.path.split('/').pop() || group.path;
          const dirName = group.path.includes('/')
            ? group.path.slice(0, group.path.lastIndexOf('/') + 1)
            : '';
          // File name matches have no matches array; content matches do.
          const isFileNameMatch = group.matches.length === 0;
          const isCollapsed = !isFileNameMatch && collapsed.has(group.path);

          return (
            <div key={group.path}>
              {/* File Header - clickable for both types */}
              <button
                type="button"
                className="sticky top-0 z-10 flex w-full items-center gap-1 bg-bg-secondary px-2 py-0.5 cursor-pointer select-none text-left hover:bg-bg-hover"
                onClick={() => {
                  if (isFileNameMatch) {
                    // File name match: open file directly.
                    handleOpenMatch(group.path, 1, 0);
                  } else {
                    // Content match: toggle collapse.
                    toggleCollapse(group.path);
                  }
                }}
                title={isFileNameMatch ? `Open ${group.path}` : group.path}
              >
                {isFileNameMatch ? (
                  <span className="w-3.5 h-3.5 shrink-0" />
                ) : isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 text-text-muted" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 shrink-0 text-text-muted" />
                )}
                <img src={iconSrc} alt="" className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[var(--font-size)] text-text-primary font-medium truncate">
                  {fileName}
                </span>
                {dirName && (
                  <span className="text-[calc(var(--font-size)-1px)] text-text-muted truncate">
                    {dirName}
                  </span>
                )}
                {!isFileNameMatch && (
                  <span className="ml-auto shrink-0 text-[calc(var(--font-size)-2px)] text-accent-blue bg-accent-blue/10 px-1.5 py-0.5 rounded-full font-medium">
                    {group.matches.length}
                  </span>
                )}
              </button>

              {/* Match Lines (only for content matches) */}
              {!isCollapsed &&
                group.matches.map((m: SearchMatch) => (
                  <button
                    key={`${group.path}:${m.line}:${m.column}`}
                    type="button"
                    onClick={() => handleOpenMatch(group.path, m.line || 1, m.column || 0)}
                    className="w-full flex items-start gap-2 px-2 py-0.5 hover:bg-bg-hover text-left"
                  >
                    <span className="shrink-0 w-8 text-right text-text-muted select-none text-[11px] font-mono leading-[18px]">
                      {m.line}
                    </span>
                    <span className="text-[var(--font-size)] text-text-primary truncate font-mono leading-[18px]">
                      {highlightMatch(m.lineText, query)}
                    </span>
                  </button>
                ))}
            </div>
          );
        })}

        {status === 'running' && fileGroups.length > 0 && (
          <div className="flex justify-center py-2">
            <Loader2 className="size-3.5 animate-spin text-text-muted" />
          </div>
        )}

        {truncated && fileGroups.length > 0 && (
          <div className="flex items-center justify-center gap-2 py-2 text-[calc(var(--font-size)-1px)] text-text-muted">
            <span>Results truncated — refine your query.</span>
          </div>
        )}
      </div>

      {/* Status Bar */}
      {fileGroups.length > 0 && (
        <div className="shrink-0 flex items-center justify-between px-2 py-1 border-t border-border bg-bg-tertiary/30">
          <span className="text-[calc(var(--font-size)-1px)] text-text-muted">
            {fileNameMatchCount > 0 &&
              `${fileNameMatchCount} file name${fileNameMatchCount !== 1 ? 's' : ''}`}
            {fileNameMatchCount > 0 && fileCount - fileNameMatchCount > 0 && ', '}
            {fileCount - fileNameMatchCount > 0 && `${fileCount - fileNameMatchCount} content`}
          </span>
          <span className="text-[calc(var(--font-size)-1px)] text-text-muted">
            {totalMatches} matches total
          </span>
        </div>
      )}
    </div>
  );
});
SearchPanel.displayName = 'SearchPanel';

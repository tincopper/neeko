import { create } from 'zustand';

import { runSearch, stopSearch } from '@/features/search/api/searchApi';
import type { SearchFileGroup, SearchOptions } from '@/shared/types/search';
import { reportFrontendError } from '@/shared/utils/errorReporting';

/** Lifecycle of the active search run. */
export type SearchStatus = 'idle' | 'running' | 'error';

/** Monotonic request id source (encapsulated in store, reset on clear). */
let requestCounter = 0;
function nextRequestId(): string {
  requestCounter += 1;
  return `search-req-${requestCounter}`;
}

interface SearchState {
  /** Active search request id (null when idle). */
  requestId: string | null;
  /** Query of the current result set. */
  query: string;
  /** Normalized groups for rendering (matches accumulated across pages). */
  fileGroups: SearchFileGroup[];
  /** Current pagination offset. */
  offset: number;
  /** Backend reported truncation (results beyond cap). */
  truncated: boolean;
  /** Options of the current query (reused for pagination). */
  options: SearchOptions;
  /** Set of collapsed file paths. */
  collapsed: Set<string>;
  /** Total match count across all files. */
  totalMatches: number;
  status: SearchStatus;
  error: string | null;

  run: (projectId: string, query: string, options: SearchOptions) => Promise<void>;
  /** Fetch the next page of the current query. */
  next: (projectId: string) => Promise<void>;
  /** Cancel the in-flight request. */
  stop: () => Promise<void>;
  /** Reset to pristine idle state. */
  clear: () => void;
  /** Toggle collapse state for a file group. */
  toggleCollapse: (path: string) => void;
}

export function resetSearchState() {
  useSearchStore.setState(initialState());
}

function initialState() {
  return {
    requestId: null,
    query: '',
    fileGroups: [] as SearchFileGroup[],
    offset: 0,
    truncated: false,
    options: {} as SearchOptions,
    collapsed: new Set<string>(),
    totalMatches: 0,
    status: 'idle' as SearchStatus,
    error: null as string | null,
  };
}

/** Ensure the backend DTO always receives an explicit `mode` field. */
function normalizeOptions(options: SearchOptions): SearchOptions {
  return { mode: 'Content', ...options };
}

export const useSearchStore = create<SearchState>((set, get) => ({
  ...initialState(),

  run: async (projectId, query, options) => {
    const requestId = nextRequestId();
    const normalized = normalizeOptions(options);
    // Fresh start: clear previous results and reset offset.
    set({
      status: 'running',
      error: null,
      query,
      truncated: false,
      offset: 0,
      fileGroups: [],
      options: normalized,
      requestId,
    });

    try {
      const res = await runSearch({
        projectId,
        query,
        requestId,
        options: normalized,
        offset: 0,
        limit: 100,
      });
      set({
        requestId: res.requestId,
        fileGroups: res.matches,
        offset: res.cursor.offset,
        truncated: res.truncated,
        totalMatches: res.matches.reduce((sum, g) => sum + g.matches.length, 0),
        status: 'idle',
      });
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  next: async (projectId) => {
    const { query, offset, options, status } = get();
    if (status === 'running' || !query) return;
    const requestId = nextRequestId();

    set({ status: 'running', requestId });

    try {
      const res = await runSearch({
        projectId,
        query,
        requestId,
        options,
        offset,
        limit: 100,
      });
      set((state) => {
        // Continuation: append new groups, replacing files that reappear.
        const known = new Map(state.fileGroups.map((f) => [f.path, f]));
        for (const group of res.matches) {
          known.set(group.path, group);
        }
        return {
          requestId: res.requestId,
          fileGroups: [...known.values()],
          offset: res.cursor.offset,
          truncated: res.truncated,
          totalMatches: [...known.values()].reduce((sum, g) => sum + g.matches.length, 0),
          status: 'idle',
        };
      });
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  stop: async () => {
    const { requestId } = get();
    if (requestId) {
      await stopSearch(requestId).catch((err) => reportFrontendError('search.stop', err));
    }
    set({ requestId: null, status: 'idle' });
  },

  clear: () => {
    requestCounter = 0;
    set(initialState());
  },

  toggleCollapse: (path) => {
    set((state) => {
      const next = new Set(state.collapsed);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return { collapsed: next };
    });
  },
}));

void resetSearchState;

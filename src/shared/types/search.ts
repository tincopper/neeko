/**
 * Search across files in a project (local / WSL / SSH).
 *
 * DTO names mirror `src-tauri/src/search/types.rs` so frontend ↔ backend
 * serialization stays in lockstep.
 */

/** Pagination state that keeps an active search resumable. */
export interface SearchCursor {
  /** Current page offset (matches already returned). */
  offset: number;
  /** Total pages expected; -1 when unknown (remote stream still running). */
  totalPages: number;
}

/** Search mode. Content searches file contents; FileName filters file names. */
export type SearchMode = 'Content' | 'FileName';

/** Options that refine which files / how to match. */
export interface SearchOptions {
  /** Content vs file-name mode. Defaults to `Content` when omitted. */
  mode?: SearchMode;
  /** Include only paths matching these globs (e.g. `["*.rs", "src/**"]`). */
  include?: string[];
  /** Exclude paths matching these globs (e.g. `["node_modules/**"]`). */
  exclude?: string[];
  /** Case-sensitive matching (default: case-insensitive). */
  caseSensitive?: boolean;
  /** Whole-word matching only. */
  wholeWord?: boolean;
  /** Interpret `query` as a regex instead of a literal string. */
  regex?: boolean;
}

/** A single match inside a file. */
export interface SearchMatch {
  /** Project-relative path of the containing file. */
  path: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column of the match start. */
  column: number;
  /** Matching line text (may be truncated for display). */
  lineText: string;
}

/** Raw per-file group of matches, as returned by the backend. */
export interface SearchFileGroup {
  path: string;
  matches: SearchMatch[];
}

/** Paginated response of a search. */
export interface SearchResponse {
  requestId: string;
  query: string;
  projectId: string;
  matches: SearchFileGroup[];
  cursor: SearchCursor;
  truncated: boolean;
}

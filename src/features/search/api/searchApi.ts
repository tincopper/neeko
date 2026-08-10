/**
 * Tauri IPC bridge for file search commands.
 *
 * `runSearch` returns an active page; repeat with the returned cursor to page
 * through results. `stopSearch` cancels an in-flight search by request id.
 */
import { invoke } from '@tauri-apps/api/core';

import type { SearchOptions, SearchResponse } from '@/shared/types/search';

export const SEARCH_COMMANDS = {
  run: 'search_run',
  stop: 'search_stop',
} as const;

/** Start or continue a paginated search. */
export async function runSearch(params: {
  projectId: string;
  query: string;
  requestId: string;
  options?: SearchOptions;
  offset?: number;
  limit?: number;
}): Promise<SearchResponse> {
  return invoke<SearchResponse>(SEARCH_COMMANDS.run, {
    query: params.query,
    projectId: params.projectId,
    requestId: params.requestId,
    options: params.options ?? null,
    offset: params.offset ?? null,
    limit: params.limit ?? null,
  });
}

/** Cancel an in-flight search by request id. */
export async function stopSearch(requestId: string): Promise<void> {
  return invoke<void>(SEARCH_COMMANDS.stop, { requestId });
}

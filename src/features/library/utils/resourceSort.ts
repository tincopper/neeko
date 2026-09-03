import type { SortMode } from '../store/libraryStore';

export interface SortPickers<T> {
  name: (item: T) => string;
  usage: (item: T) => number;
  updated: (item: T) => number;
}

/**
 * Shared resource ordering (alphabetical / frequent / recent) for the
 * Prompts and MCP lists. Always copies — never sort a store array in place
 * during render (that mutates cached state).
 */
export function sortResources<T>(
  list: readonly T[],
  sortMode: SortMode,
  pick: SortPickers<T>,
): T[] {
  const sorted = [...list];
  if (sortMode === 'alphabetical') {
    sorted.sort((a, b) => pick.name(a).localeCompare(pick.name(b)));
  } else if (sortMode === 'frequent') {
    sorted.sort((a, b) => pick.usage(b) - pick.usage(a));
  } else {
    sorted.sort((a, b) => pick.updated(b) - pick.updated(a));
  }
  return sorted;
}

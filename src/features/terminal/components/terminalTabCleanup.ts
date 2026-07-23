import { useEditorStore } from "@/shared/store";
import { parseProjectIdFromTabKey } from "@/shared/utils/tabKey";

import {
  destroyRemoteCache,
  destroyTerminalCache,
  destroyTerminalCachesByPrefix,
  destroyWslCache,
  remoteTerminalCache,
  terminalCache,
  wslTerminalCache,
} from "./terminalCache";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when cache key contains `tabId` as a full `:`-delimited segment. */
function keyHasTabSegment(key: string, tabId: string): boolean {
  const mid = `:${tabId}:`;
  const end = `:${tabId}`;
  return key.includes(mid) || key.endsWith(end);
}

function destroyMatchingKeys(
  keys: Iterable<string>,
  destroyOne: (key: string) => void,
  predicate: (key: string) => boolean,
): void {
  for (const key of Array.from(keys)) {
    if (predicate(key)) {
      destroyOne(key);
    }
  }
}

/**
 * Tear down local / WSL / remote terminal PTY caches for a single editor tab.
 *
 * Local cache keys look like:
 * - `{tabKey}:{tabId}:{paneId}`
 * - `{projectId}:wt:{path}:{tabId}:{paneId}` when tabKey is the worktree tab space
 *
 * WSL / remote embed the tab id mid-key, e.g. `wsl:{distro}:{projectId}:{tabId}:p1`.
 */
export function cleanupTerminalsForTab(tabKey: string, tabId: string): void {
  // Primary local prefix (covers main + worktree tab spaces and pane suffixes).
  destroyTerminalCachesByPrefix(`${tabKey}:${tabId}`);

  // Safety net: any local key that still embeds this tab id (split panes, legacy).
  destroyMatchingKeys(terminalCache.keys(), destroyTerminalCache, (key) =>
    keyHasTabSegment(key, tabId),
  );

  destroyMatchingKeys(wslTerminalCache.keys(), destroyWslCache, (key) =>
    keyHasTabSegment(key, tabId),
  );
  destroyMatchingKeys(remoteTerminalCache.keys(), destroyRemoteCache, (key) =>
    keyHasTabSegment(key, tabId),
  );
}

/**
 * Tear down all terminal caches associated with a tab space (`projectId` or
 * `projectId:wt:path`), used when clearing every tab in that space.
 */
export function cleanupTerminalsForTabKey(tabKey: string): void {
  destroyTerminalCachesByPrefix(tabKey);

  const projectId = parseProjectIdFromTabKey(tabKey);
  // Only sweep env-scoped caches when clearing the main project tab space.
  // Worktree tab spaces share the project id but use different cache encodings;
  // their local keys are already covered by the tabKey prefix above.
  if (projectId !== tabKey) {
    return;
  }

  const wslRe = new RegExp(`^wsl:[^:]+:${escapeRegExp(projectId)}(?::|$)`);
  const remoteRe = new RegExp(`^remote:[^:]+:${escapeRegExp(projectId)}(?::|$)`);

  destroyMatchingKeys(wslTerminalCache.keys(), destroyWslCache, (key) =>
    wslRe.test(key),
  );
  destroyMatchingKeys(remoteTerminalCache.keys(), destroyRemoteCache, (key) =>
    remoteRe.test(key),
  );
}

/** Close one editor tab and recycle any terminal PTY behind it. */
export function closeEditorTab(tabKey: string, tabId: string): void {
  cleanupTerminalsForTab(tabKey, tabId);
  useEditorStore.getState().closeTab(tabKey, tabId);
}

/** Close every tab in a tab space and recycle terminal PTYs. */
export function closeAllEditorTabs(tabKey: string): void {
  const existing = useEditorStore.getState().tabs[tabKey];
  if (existing) {
    for (const tab of existing.tabs) {
      cleanupTerminalsForTab(tabKey, tab.id);
    }
  }
  cleanupTerminalsForTabKey(tabKey);
  useEditorStore.getState().clearProjectTabs(tabKey);
}

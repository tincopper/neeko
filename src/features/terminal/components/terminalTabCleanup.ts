import { useEditorStore } from '@/shared/store/editorStore';
import { isMainCheckout, parseWorkspaceKey } from '@/shared/utils/workspaceRef';

import {
  destroyRemoteCache,
  destroyTerminalCache,
  destroyTerminalCachesByPrefix,
  destroyWslCache,
  remoteTerminalCache,
  terminalCache,
  wslTerminalCache,
} from './terminalCache';

/**
 * tab 空间键 → 终端本地 cache key 前缀的**唯一换算点**。
 *
 * editor 的 tab 组键是 canonical `WorkspaceKey`（`{projectId}\u0000{wtPath}`，裸
 * `projectId` 亦按主 checkout 解析）；终端 PTY 缓存保持自己的 `:wt:` 命名空间
 * （`{projectId}:wt:{path}:…`，唯一实现处 strategies/terminalCache）。清理入口收到
 * 的是 editor 键，两个命名空间之间的转换必须且只能发生在这里 —— 调用方不得手拼
 * cache key，清理也不得拿 NUL 形态直接做前缀（永不命中 = PTY 泄漏）。
 */
function terminalSpacePrefix(tabKey: string): string {
  const { projectId, worktreePath } = parseWorkspaceKey(tabKey);
  return worktreePath === null ? projectId : `${projectId}:wt:${worktreePath}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
 * - `{projectId}:{tabId}:{paneId}` (main space)
 * - `{projectId}:wt:{path}:{tabId}:{paneId}` (worktree space)
 *
 * The incoming `tabKey` is the editor group key (canonical `WorkspaceKey`);
 * it is translated to the terminal namespace via `terminalSpacePrefix`.
 *
 * WSL / remote embed the tab id mid-key, e.g. `wsl:{distro}:{projectId}:{tabId}:p1`.
 */
export function cleanupTerminalsForTab(tabKey: string, tabId: string): void {
  // Primary local prefix (covers main + worktree tab spaces and pane suffixes).
  destroyTerminalCachesByPrefix(`${terminalSpacePrefix(tabKey)}:${tabId}`);

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
 * Tear down all terminal caches associated with a tab space (canonical
 * `WorkspaceKey`, or a bare `projectId` = main space), used when clearing every
 * tab in that space.
 */
export function cleanupTerminalsForTabKey(tabKey: string): void {
  destroyTerminalCachesByPrefix(terminalSpacePrefix(tabKey));

  // Only sweep env-scoped caches when clearing the main project tab space.
  // Worktree tab spaces share the project id but use different cache encodings;
  // their local keys are already covered by the tabKey prefix above.
  if (!isMainCheckout(tabKey)) {
    return;
  }

  const { projectId } = parseWorkspaceKey(tabKey);
  const wslRe = new RegExp(`^wsl:[^:]+:${escapeRegExp(projectId)}(?::|$)`);
  const remoteRe = new RegExp(`^remote:[^:]+:${escapeRegExp(projectId)}(?::|$)`);

  destroyMatchingKeys(wslTerminalCache.keys(), destroyWslCache, (key) => wslRe.test(key));
  destroyMatchingKeys(remoteTerminalCache.keys(), destroyRemoteCache, (key) => remoteRe.test(key));
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

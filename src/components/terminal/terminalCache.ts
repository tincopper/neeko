import { createTerminalCacheBackend } from "./unifiedTerminalCache";
import type { TerminalCache } from "./terminalTypes";

const backend = createTerminalCacheBackend<TerminalCache>({
  prefix: "",
  closeSessionCmd: "close_terminal_session",
  resizeSessionCmd: "resize_terminal",
  logPrefix: "[Terminal]",
  trackExecutedAgents: true,
});

// ---- Re-export factory maps with original names ----
export const terminalCache = backend.cache;
export const terminalRebuildCallbacks = backend.rebuildCallbacks;
export const terminalWrapperRefs = backend.wrapperRefs;
export const executedAgentKeys = backend.executedAgentKeys!;

// ---- Module-level local-specific state (not cache-managed) ----
export let pendingPtyResize = false;
export function setPendingPtyResize(v: boolean) {
  pendingPtyResize = v;
}

// ---- Key builder (preserves original signature) ----
export function terminalCacheKey(
  projectId: string,
  tabId?: string | null,
  paneId = "p1",
) {
  return tabId
    ? backend.cacheKey(projectId, tabId, paneId)
    : backend.cacheKey(projectId, paneId);
}

// ---- Re-export factory utilities with original names ----
export const log = backend.log;

export function destroyTerminalCache(cacheKey: string) {
  backend.destroyCache(cacheKey);
}

export function destroyTerminalCachesByPrefix(prefix: string) {
  backend.destroyCachesByPrefix(prefix);
}

export function refreshTerminal(projectId: string) {
  backend.refreshTerminal(projectId);
}

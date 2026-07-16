import { emit } from "@tauri-apps/api/event";
import { getAgent } from "../../agent/api/agentApi";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import type { TerminalInputController } from "./terminalInput";
import type { TerminalCache } from "./terminalTypes";
import { closeTerminalSession, closeRemoteTerminalSession } from "../api/terminalApi";

// =============================================================================
// Factory — shared by local / WSL / remote cache modules
// =============================================================================

/** Minimal common shape that all three cache types satisfy. */
interface CacheEntry {
  term: Terminal;
  sessionId: string | null;
  inputController: TerminalInputController | null;
  unlisten?: (() => void) | null;
  unlistenOutput?: (() => void) | null;
  unlistenClosed?: (() => void) | null;
}

export interface CacheBackendOptions {
  /** Cache key prefix, e.g. "wsl:", "remote:", "" */
  prefix: string;
  /** Close a terminal session */
  closeSession: (sessionId: string) => Promise<void>;
  /** Log prefix, e.g. "[WSL]", "[SSH]", "[Terminal]" */
  logPrefix: string;
  /** Whether to track executed agent keys (local only) */
  trackExecutedAgents?: boolean;
}

export function createTerminalCacheBackend<TCache extends CacheEntry>(
  options: CacheBackendOptions,
) {
  const { prefix, closeSession, logPrefix, trackExecutedAgents } = options;

  // ---- internal maps ----
  const cache = new Map<string, TCache>();
  const rebuildCallbacks = new Map<string, () => void>();
  const wrapperRefs = new Map<string, HTMLDivElement>();
  const executedAgentKeys = trackExecutedAgents ? new Set<string>() : undefined;

  // ---- utilities ----

  function log(msg: string) {
    const ts = new Date().toLocaleTimeString();
    console.debug(`['${ts}'] ${logPrefix} ${msg}`);
  }

  function cacheKey(...parts: (string | null | undefined)[]): string {
    return prefix + parts.filter(Boolean).join(":");
  }

  function resolveCacheKey(keyOrPrefix: string): string | null {
    if (cache.has(keyOrPrefix)) return keyOrPrefix;
    for (const key of cache.keys()) {
      if (key.startsWith(keyOrPrefix + ":")) {
        return key;
      }
    }
    return null;
  }

  function destroyCache(key: string): void {
    const entry = cache.get(key);
    if (!entry) return;

    if (entry.unlisten) entry.unlisten();
    if (entry.unlistenOutput) entry.unlistenOutput();
    if (entry.unlistenClosed) entry.unlistenClosed();

    entry.inputController?.dispose();
    entry.term.dispose();

    if (entry.sessionId) {
      closeSession(entry.sessionId).catch(() => {});
    }

    cache.delete(key);
    rebuildCallbacks.delete(key);
    wrapperRefs.delete(key);
    if (executedAgentKeys) executedAgentKeys.delete(key);

    log(`Cache destroyed for ${key}`);
  }

  function destroyCachesByPrefix(prefix: string): void {
    const keys = Array.from(cache.keys());
    for (const key of keys) {
      if (key === prefix || key.startsWith(prefix + ":")) {
        destroyCache(key);
      }
    }
  }

  function refreshTerminal(key: string): void {
    const resolved = resolveCacheKey(key);
    if (!resolved) return;

    const entry = cache.get(resolved);
    if (!entry) return;

    const rebuildCb = rebuildCallbacks.get(resolved);

    if (entry.unlisten) entry.unlisten();
    if (entry.unlistenOutput) entry.unlistenOutput();
    if (entry.unlistenClosed) entry.unlistenClosed();
    entry.inputController?.dispose();

    if (entry.sessionId) {
      closeSession(entry.sessionId).catch(() => {});
    }

    entry.term.dispose();

    cache.delete(resolved);
    rebuildCallbacks.delete(resolved);
    wrapperRefs.delete(resolved);
    if (executedAgentKeys) executedAgentKeys.delete(resolved);

    log(`Cache destroyed for ${resolved}`);

    rebuildCb?.();
  }

  function launchAgentInTerminal(
    cacheKeyOrPrefix: string,
    command: string,
    args: string[],
  ): void {
    const resolved = resolveCacheKey(cacheKeyOrPrefix);
    if (!resolved) return;

    const entry = cache.get(resolved);
    if (!entry?.sessionId) return;

    const sessionId = entry.sessionId;
    const ctrlC = Array.from(new TextEncoder().encode("\x03"));
    emit(`terminal-input-${sessionId}`, ctrlC).catch(() => {});

    setTimeout(() => {
      const cmdStr = [command, ...args].join(" ") + "\r";
      const bytes = Array.from(new TextEncoder().encode(cmdStr));
      emit(`terminal-input-${sessionId}`, bytes).catch(() => {});
    }, 50);
  }

  function getSessionId(key: string): string | null {
    return cache.get(key)?.sessionId ?? null;
  }

  return {
    cache,
    rebuildCallbacks,
    wrapperRefs,
    executedAgentKeys,
    cacheKey,
    resolveCacheKey,
    destroyCache,
    destroyCachesByPrefix,
    refreshTerminal,
    launchAgentInTerminal,
    getSessionId,
    log,
  };
}

// =============================================================================
// Local terminal cache — instance and exports
// =============================================================================

const backend = createTerminalCacheBackend<TerminalCache>({
  prefix: "",
  closeSession: closeTerminalSession,
  logPrefix: "[Terminal]",
  trackExecutedAgents: true,
});

export const terminalCache = backend.cache;
export const terminalRebuildCallbacks = backend.rebuildCallbacks;
export const terminalWrapperRefs = backend.wrapperRefs;
export const executedAgentKeys = backend.executedAgentKeys!;

export function terminalCacheKey(
  projectId: string,
  tabId?: string | null,
  paneId = "p1",
) {
  return tabId
    ? backend.cacheKey(projectId, tabId, paneId)
    : backend.cacheKey(projectId, paneId);
}

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

// =============================================================================
// WSL terminal cache — instance and exports
// =============================================================================

export interface WslTerminalCache {
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  sessionId: string | null;
  unlisten: (() => void) | null;
  inputController: TerminalInputController | null;
}

const wslBackend = createTerminalCacheBackend<WslTerminalCache>({
  prefix: "wsl:",
  closeSession: closeTerminalSession,
  logPrefix: "[WSL]",
});

export const wslTerminalCache = wslBackend.cache;
export const wslRebuildCallbacks = wslBackend.rebuildCallbacks;
export const wslWrapperRefs = wslBackend.wrapperRefs;

export function wslCacheKey(distro: string, projectId: string) {
  return wslBackend.cacheKey(distro, projectId);
}

function parseProjectIdFromWslKey(key: string): string | null {
  const withWorktree = key.match(/^wsl:.+:([^:]+):wt:[^:]+:p\d+$/);
  if (withWorktree) return withWorktree[1];
  const normal = key.match(/^wsl:.+:([^:]+):p\d+$/);
  if (normal) return normal[1];
  return null;
}

export function destroyWslCache(key: string) {
  const resolved = wslBackend.resolveCacheKey(key);
  if (!resolved) return;
  wslBackend.destroyCache(resolved);
}

export function destroyWslCachesByPrefix(prefix: string) {
  wslBackend.destroyCachesByPrefix(prefix);
}

export function refreshWslTerminal(key: string) {
  wslBackend.refreshTerminal(key);
}

export function getWslSessionId(key: string): string | null {
  return wslBackend.getSessionId(key);
}

export function getWslOpenProjectIds(distro: string): Set<string> {
  const result = new Set<string>();
  for (const [key, cache] of wslTerminalCache.entries()) {
    if (key.startsWith(`wsl:${distro}:`) && cache.sessionId) {
      const projectId = parseProjectIdFromWslKey(key);
      if (projectId) result.add(projectId);
    }
  }
  return result;
}

export function getAllWslOpenProjectIds(): Set<string> {
  const result = new Set<string>();
  for (const [key, cache] of wslTerminalCache.entries()) {
    if (key.startsWith("wsl:") && cache.sessionId) {
      const projectId = parseProjectIdFromWslKey(key);
      if (projectId) result.add(projectId);
    }
  }
  return result;
}

export function launchAgentInWslTerminal(
  cacheKey: string,
  command: string,
  args: string[],
) {
  wslBackend.launchAgentInTerminal(cacheKey, command, args);
}

export async function switchAgentInWslTerminal(
  cacheKey: string,
  _distro: string,
  _projectPath: string,
  _projectName: string,
  agentId: string,
  _fontSize: number,
  _fontFamily: string,
  agentCommandOverrides?: Record<string, string>,
) {
  const resolved = wslBackend.resolveCacheKey(cacheKey) ?? cacheKey;
  const wrapper = wslWrapperRefs.get(resolved);
  if (!wrapper) {
    const agent = await getAgent(agentId).catch(() => null);
    if (agent) {
      const cmd = agentCommandOverrides?.[agent.id] ?? agent.command;
      launchAgentInWslTerminal(cacheKey, cmd, agent.args);
    }
    return;
  }

  const oldCache = wslTerminalCache.get(resolved);
  if (oldCache) {
    oldCache.unlisten?.();
    oldCache.inputController?.dispose();
  }

  wslTerminalCache.delete(resolved);

  while (wrapper.firstChild) {
    wrapper.removeChild(wrapper.firstChild);
  }

  wslRebuildCallbacks.get(resolved)?.();

  if (oldCache?.sessionId) {
    closeTerminalSession(oldCache.sessionId).catch(() => {});
  }
  oldCache?.term.dispose();
}

// =============================================================================
// Remote terminal cache — instance and exports
// =============================================================================

export interface RemoteTerminalCache {
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  sessionId: string | null;
  unlisten: (() => void) | null;
  inputController: TerminalInputController | null;
}

const remoteBackend = createTerminalCacheBackend<RemoteTerminalCache>({
  prefix: "remote:",
  closeSession: closeRemoteTerminalSession,
  logPrefix: "[SSH]",
});

export const remoteTerminalCache = remoteBackend.cache;
export const remoteRebuildCallbacks = remoteBackend.rebuildCallbacks;
export const remoteWrapperRefs = remoteBackend.wrapperRefs;

export function remoteCacheKey(entryId: string, projectId: string) {
  return remoteBackend.cacheKey(entryId, projectId);
}

export function destroyRemoteCache(key: string) {
  const resolved = remoteBackend.resolveCacheKey(key);
  if (!resolved) return;
  remoteBackend.destroyCache(resolved);
}

export function destroyRemoteCachesByPrefix(prefix: string) {
  remoteBackend.destroyCachesByPrefix(prefix);
}

export function refreshRemoteTerminal(key: string) {
  remoteBackend.refreshTerminal(key);
}

export function launchAgentInRemoteTerminal(
  cacheKey: string,
  command: string,
  args: string[],
) {
  remoteBackend.launchAgentInTerminal(cacheKey, command, args);
}

export async function switchAgentInRemoteTerminal(
  cacheKey: string,
  agentId: string,
  agentCommandOverrides?: Record<string, string>,
) {
  const resolved = remoteBackend.resolveCacheKey(cacheKey) ?? cacheKey;
  const wrapper = remoteWrapperRefs.get(resolved);
  if (!wrapper) {
    const agent = await getAgent(agentId).catch(() => null);
    if (agent) {
      const cmd = agentCommandOverrides?.[agent.id] ?? agent.command;
      launchAgentInRemoteTerminal(cacheKey, cmd, agent.args);
    }
    return;
  }

  const oldCache = remoteTerminalCache.get(resolved);
  if (oldCache) {
    oldCache.unlisten?.();
    oldCache.inputController?.dispose();
  }

  remoteTerminalCache.delete(resolved);

  while (wrapper.firstChild) {
    wrapper.removeChild(wrapper.firstChild);
  }

  remoteRebuildCallbacks.get(resolved)?.();

  if (oldCache?.sessionId) {
    closeRemoteTerminalSession(oldCache.sessionId).catch(() => {});
  }
  oldCache?.term.dispose();
}

// =============================================================================
// Unified terminal cache manager
// =============================================================================

/**
 * Resolves the appropriate cache backend for a cache key by inspecting its
 * prefix ("wsl:", "remote:", or bare key for local).
 */
function resolveBackendForKey(
  key: string,
): {
  cache: Map<string, unknown>;
  rebuildCallbacks: Map<string, () => void>;
  wrapperRefs: Map<string, HTMLDivElement>;
  resolveCacheKey: (k: string) => string | null;
  launchAgentInTerminal: (k: string, cmd: string, args: string[]) => void;
  destroyCache: (k: string) => void;
  refreshTerminal: (k: string) => void;
} {
  if (key.startsWith("wsl:")) {
    return wslBackend;
  }
  if (key.startsWith("remote:")) {
    return remoteBackend;
  }
  return backend;
}

/**
 * Unified launch agent — works for any cache key (local, wsl, remote).
 *
 * Dispatches to the correct backend based on the key prefix.
 */
export function launchAgentInAnyTerminal(
  cacheKey: string,
  command: string,
  args: string[],
): void {
  const bk = resolveBackendForKey(cacheKey);
  bk.launchAgentInTerminal(cacheKey, command, args);
}

/**
 * Unified switch agent — works for any cache key (local, wsl, remote).
 *
 * Dispatches to the correct backend based on the key prefix.
 */
export async function switchAgentInAnyTerminal(
  cacheKey: string,
  agentId: string,
  agentCommandOverrides?: Record<string, string>,
): Promise<void> {
  const bk = resolveBackendForKey(cacheKey);
  const resolved = bk.resolveCacheKey(cacheKey) ?? cacheKey;
  const wrapper = bk.wrapperRefs.get(resolved);

  if (!wrapper) {
    const agent = await getAgent(agentId).catch(() => null);
    if (agent) {
      const cmd = agentCommandOverrides?.[agent.id] ?? agent.command;
      bk.launchAgentInTerminal(cacheKey, cmd, agent.args);
    }
    return;
  }

  // Destroy old cache entry
  const oldCache = bk.cache.get(resolved) as CacheEntry | undefined;
  if (oldCache) {
    oldCache.unlisten?.();
    oldCache.inputController?.dispose();
  }

  bk.cache.delete(resolved);
  while (wrapper.firstChild) {
    wrapper.removeChild(wrapper.firstChild);
  }

  bk.rebuildCallbacks.get(resolved)?.();

  if (oldCache?.sessionId) {
    closeTerminalSession(oldCache.sessionId).catch(() => {});
  }
  oldCache?.term.dispose();
}

import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import type { Terminal } from "@xterm/xterm";
import type { TerminalInputController } from "./terminalInput";

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
  /** Invoke command to close a session */
  closeSessionCmd: string;
  /** Invoke command to resize a session */
  resizeSessionCmd: string;
  /** Log prefix, e.g. "[WSL]", "[SSH]", "[Terminal]" */
  logPrefix: string;
  /** Whether to track executed agent keys (local only) */
  trackExecutedAgents?: boolean;
}

export function createTerminalCacheBackend<TCache extends CacheEntry>(
  options: CacheBackendOptions,
) {
  const { prefix, closeSessionCmd, logPrefix, trackExecutedAgents } = options;

  // ---- internal maps ----
  const cache = new Map<string, TCache>();
  const rebuildCallbacks = new Map<string, () => void>();
  const wrapperRefs = new Map<string, HTMLDivElement>();
  const executedAgentKeys = trackExecutedAgents ? new Set<string>() : undefined;

  // ---- utilities ----

  function log(msg: string) {
    const ts = new Date().toLocaleTimeString();
    console.debug(`[${ts}] ${logPrefix} ${msg}`);
  }

  /**
   * Build a cache key by joining non-empty parts.
   * The configured prefix is prepended automatically.
   */
  function cacheKey(...parts: (string | null | undefined)[]): string {
    return prefix + parts.filter(Boolean).join(":");
  }

  /**
   * Resolve a key-or-prefix to an exact cache key.
   * Returns the exact match if it exists, otherwise the first key
   * that starts with `keyOrPrefix + ":"`.
   */
  function resolveCacheKey(keyOrPrefix: string): string | null {
    if (cache.has(keyOrPrefix)) return keyOrPrefix;
    for (const key of cache.keys()) {
      if (key.startsWith(keyOrPrefix + ":")) {
        return key;
      }
    }
    return null;
  }

  /** Dispose terminal, close PTY, and delete from all associated maps. */
  function destroyCache(key: string): void {
    const entry = cache.get(key);
    if (!entry) return;

    // Unregister all listener patterns
    if (entry.unlisten) entry.unlisten();
    if (entry.unlistenOutput) entry.unlistenOutput();
    if (entry.unlistenClosed) entry.unlistenClosed();

    entry.inputController?.dispose();
    entry.term.dispose();

    if (entry.sessionId) {
      invoke(closeSessionCmd, { sessionId: entry.sessionId }).catch(() => {});
    }

    cache.delete(key);
    rebuildCallbacks.delete(key);
    wrapperRefs.delete(key);
    if (executedAgentKeys) executedAgentKeys.delete(key);

    log(`Cache destroyed for ${key}`);
  }

  /** Destroy all caches whose key matches the given prefix. */
  function destroyCachesByPrefix(prefix: string): void {
    const keys = Array.from(cache.keys());
    for (const key of keys) {
      if (key === prefix || key.startsWith(prefix + ":")) {
        destroyCache(key);
      }
    }
  }

  /**
   * Refresh a terminal: close PTY, destroy cache, then trigger rebuild callback.
   * The rebuild callback is saved before destruction to ensure it can be invoked.
   */
  function refreshTerminal(key: string): void {
    const resolved = resolveCacheKey(key);
    if (!resolved) return;

    const entry = cache.get(resolved);
    if (!entry) return;

    // Save rebuild callback before clearing maps
    const rebuildCb = rebuildCallbacks.get(resolved);

    // Clean up listeners and input controller
    if (entry.unlisten) entry.unlisten();
    if (entry.unlistenOutput) entry.unlistenOutput();
    if (entry.unlistenClosed) entry.unlistenClosed();
    entry.inputController?.dispose();

    if (entry.sessionId) {
      invoke(closeSessionCmd, { sessionId: entry.sessionId }).catch(() => {});
    }

    entry.term.dispose();

    cache.delete(resolved);
    rebuildCallbacks.delete(resolved);
    wrapperRefs.delete(resolved);
    if (executedAgentKeys) executedAgentKeys.delete(resolved);

    log(`Cache destroyed for ${resolved}`);

    // Trigger rebuild via the saved callback
    rebuildCb?.();
  }

  /**
   * Send Ctrl+C followed by a command string to an existing terminal session.
   * Resolves the cache key first; silently returns if no active session exists.
   */
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

  /** Get the sessionId for a given exact cache key, or null. */
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

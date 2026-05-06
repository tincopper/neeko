import { invoke } from "@tauri-apps/api/core";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import type { TerminalInputController } from "./terminalInput";
import { createTerminalCacheBackend } from "./unifiedTerminalCache";

export interface RemoteTerminalCache {
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  sessionId: string | null;
  unlisten: (() => void) | null;
  inputController: TerminalInputController | null;
}

const backend = createTerminalCacheBackend<RemoteTerminalCache>({
  prefix: "remote:",
  closeSessionCmd: "close_remote_terminal_session",
  resizeSessionCmd: "resize_remote_terminal",
  logPrefix: "[SSH]",
});

// ---- Re-export factory maps with original names ----
export const remoteTerminalCache = backend.cache;
export const remoteRebuildCallbacks = backend.rebuildCallbacks;
export const remoteWrapperRefs = backend.wrapperRefs;

// ---- Key builder ----
export function remoteCacheKey(entryId: string, projectId: string) {
  return backend.cacheKey(entryId, projectId);
}

// ---- Cache lifecycle (thin wrappers around factory) ----

export function destroyRemoteCache(key: string) {
  const resolved = backend.resolveCacheKey(key);
  if (!resolved) return;
  backend.destroyCache(resolved);
}

export function destroyRemoteCachesByPrefix(prefix: string) {
  backend.destroyCachesByPrefix(prefix);
}

export function refreshRemoteTerminal(key: string) {
  backend.refreshTerminal(key);
}

// ---- Agent interaction ----

export function launchAgentInRemoteTerminal(
  cacheKey: string,
  command: string,
  args: string[],
) {
  backend.launchAgentInTerminal(cacheKey, command, args);
}

/**
 * Instantaneously switch SSH Remote Agent: clear old PTY cache + trigger rebuild,
 * close old PTY in background asynchronously.
 */
export async function switchAgentInRemoteTerminal(
  cacheKey: string,
  agentId: string,
  agentCommandOverrides?: Record<string, string>,
) {
  const resolved = backend.resolveCacheKey(cacheKey) ?? cacheKey;
  const wrapper = remoteWrapperRefs.get(resolved);
  if (!wrapper) {
    // Fallback: wrapper not ready, use old path
    const agent = await invoke<{ id: string; command: string; args: string[] }>(
      "get_agent",
      { agentId },
    ).catch(() => null);
    if (agent) {
      const cmd = agentCommandOverrides?.[agent.id] ?? agent.command;
      launchAgentInRemoteTerminal(cacheKey, cmd, agent.args);
    }
    return;
  }

  // 1. Remove old cache event listeners
  const oldCache = remoteTerminalCache.get(resolved);
  if (oldCache) {
    oldCache.unlisten?.();
    oldCache.inputController?.dispose();
  }

  // 2. Delete old entry
  remoteTerminalCache.delete(resolved);

  // 3. Clear wrapper DOM
  while (wrapper.firstChild) {
    wrapper.removeChild(wrapper.firstChild);
  }

  // 4. Trigger rebuild (selectedAgentId already updated to props by handleSelectRemoteAgent)
  remoteRebuildCallbacks.get(resolved)?.();

  // 5. Close old SSH PTY in background (note: uses close_remote_terminal_session)
  if (oldCache?.sessionId) {
    invoke("close_remote_terminal_session", {
      sessionId: oldCache.sessionId,
    }).catch(() => {});
  }
  oldCache?.term.dispose();
}

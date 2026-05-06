import { invoke } from "@tauri-apps/api/core";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import type { TerminalInputController } from "./terminalInput";
import { createTerminalCacheBackend } from "./unifiedTerminalCache";

export interface WslTerminalCache {
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  sessionId: string | null;
  unlisten: (() => void) | null;
  inputController: TerminalInputController | null;
}

const backend = createTerminalCacheBackend<WslTerminalCache>({
  prefix: "wsl:",
  closeSessionCmd: "close_terminal_session",
  resizeSessionCmd: "resize_terminal",
  logPrefix: "[WSL]",
});

// ---- Re-export factory maps with original names ----
export const wslTerminalCache = backend.cache;
export const wslRebuildCallbacks = backend.rebuildCallbacks;
export const wslWrapperRefs = backend.wrapperRefs;

// ---- Key builder ----
export function wslCacheKey(distro: string, projectId: string) {
  return backend.cacheKey(distro, projectId);
}

// ---- WSL-specific utility: parse projectId from a cache key ----
function parseProjectIdFromWslKey(key: string): string | null {
  const withWorktree = key.match(/^wsl:.+:([^:]+):wt:[^:]+:p\d+$/);
  if (withWorktree) return withWorktree[1];
  const normal = key.match(/^wsl:.+:([^:]+):p\d+$/);
  if (normal) return normal[1];
  return null;
}

// ---- Cache lifecycle (thin wrappers around factory) ----

export function destroyWslCache(key: string) {
  const resolved = backend.resolveCacheKey(key);
  if (!resolved) return;
  backend.destroyCache(resolved);
}

export function destroyWslCachesByPrefix(prefix: string) {
  backend.destroyCachesByPrefix(prefix);
}

export function refreshWslTerminal(key: string) {
  backend.refreshTerminal(key);
}

// ---- WSL-specific query helpers ----

export function getWslSessionId(key: string): string | null {
  return backend.getSessionId(key);
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

// ---- Agent interaction ----

export function launchAgentInWslTerminal(
  cacheKey: string,
  command: string,
  args: string[],
) {
  backend.launchAgentInTerminal(cacheKey, command, args);
}

/**
 * Instantaneously switch WSL Agent: clear old PTY cache + trigger rebuild,
 * close old PTY in background asynchronously.
 * The component reads the latest selectedAgentId prop on rebuild and
 * automatically starts the new Agent.
 */
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
  const resolved = backend.resolveCacheKey(cacheKey) ?? cacheKey;
  const wrapper = wslWrapperRefs.get(resolved);
  if (!wrapper) {
    // Fallback: wrapper not ready, use old path
    const agent = await invoke<{ id: string; command: string; args: string[] }>(
      "get_agent",
      { agentId },
    ).catch(() => null);
    if (agent) {
      const cmd = agentCommandOverrides?.[agent.id] ?? agent.command;
      launchAgentInWslTerminal(cacheKey, cmd, agent.args);
    }
    return;
  }

  // 1. Remove old cache event listeners to prevent terminal-closed triggering unexpected rebuild
  const oldCache = wslTerminalCache.get(resolved);
  if (oldCache) {
    oldCache.unlisten?.();
    oldCache.inputController?.dispose();
  }

  // 2. Delete old entry (slot vacated, filled with new instance on rebuild)
  wslTerminalCache.delete(resolved);

  // 3. Clear wrapper DOM
  while (wrapper.firstChild) {
    wrapper.removeChild(wrapper.firstChild);
  }

  // 4. Trigger rebuild (selectedAgentId already updated to props by handleSelectWslAgent)
  wslRebuildCallbacks.get(resolved)?.();

  // 5. Close old PTY in background asynchronously
  if (oldCache?.sessionId) {
    invoke("close_terminal_session", {
      sessionId: oldCache.sessionId,
    }).catch(() => {});
  }
  oldCache?.term.dispose();
}

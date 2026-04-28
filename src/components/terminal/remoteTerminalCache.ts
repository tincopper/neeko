import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import type { TerminalInputController } from "./terminalInput";

export interface RemoteTerminalCache {
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  sessionId: string | null;
  unlisten: (() => void) | null;
  inputController: TerminalInputController | null;
}

// 全局缓存：key = "remote:{entryId}:{projectId}"
export const remoteTerminalCache = new Map<string, RemoteTerminalCache>();

/** Remote 终端重建回调注册表 */
export const remoteRebuildCallbacks = new Map<string, () => void>();

/** DOM wrapper 节点注册表，供 switchAgentInRemoteTerminal 使用 */
export const remoteWrapperRefs = new Map<string, HTMLDivElement>();

export function remoteCacheKey(entryId: string, projectId: string) {
  return `remote:${entryId}:${projectId}`;
}

function resolveRemoteCacheKey(keyOrPrefix: string): string | null {
  if (remoteTerminalCache.has(keyOrPrefix)) return keyOrPrefix;
  for (const key of remoteTerminalCache.keys()) {
    if (key.startsWith(keyOrPrefix + ":")) {
      return key;
    }
  }
  return null;
}

/** 向已有 SSH 终端会话发送 agent 命令（Ctrl+C 中断当前进程后重新启动） */
export function launchAgentInRemoteTerminal(cacheKey: string, command: string, args: string[]) {
  const resolved = resolveRemoteCacheKey(cacheKey);
  if (!resolved) return;
  const cache = remoteTerminalCache.get(resolved);
  if (!cache?.sessionId) return;
  const sessionId = cache.sessionId;
  const ctrlC = Array.from(new TextEncoder().encode("\x03"));
  emit(`terminal-input-${sessionId}`, ctrlC).catch(() => {});
  setTimeout(() => {
    const cmdStr = [command, ...args].join(" ") + "\r";
    const bytes = Array.from(new TextEncoder().encode(cmdStr));
    emit(`terminal-input-${sessionId}`, bytes).catch(() => {});
  }, 50);
}

/**
 * 即时切换 SSH Remote Agent：清除旧 PTY 缓存 + 触发重建，后台异步关闭旧 PTY。
 */
export async function switchAgentInRemoteTerminal(
  cacheKey: string,
  agentId: string,
  agentCommandOverrides?: Record<string, string>,
) {
  const resolved = resolveRemoteCacheKey(cacheKey) ?? cacheKey;
  const wrapper = remoteWrapperRefs.get(resolved);
  if (!wrapper) {
    // 回退：wrapper 未就绪，用旧路径
    const agent = await invoke<{ id: string; command: string; args: string[] }>(
      "get_agent", { agentId },
    ).catch(() => null);
    if (agent) {
      const cmd = agentCommandOverrides?.[agent.id] ?? agent.command;
      launchAgentInRemoteTerminal(cacheKey, cmd, agent.args);
    }
    return;
  }

  // 1. 摘除旧缓存事件监听
  const oldCache = remoteTerminalCache.get(resolved);
  if (oldCache) {
    oldCache.unlisten?.();
    oldCache.inputController?.dispose();
  }

  // 2. 删除旧条目
  remoteTerminalCache.delete(resolved);

  // 3. 清空 wrapper DOM
  while (wrapper.firstChild) {
    wrapper.removeChild(wrapper.firstChild);
  }

  // 4. 触发重建（selectedAgentId 已由 handleSelectRemoteAgent 更新到 props）
  remoteRebuildCallbacks.get(resolved)?.();

  // 5. 后台异步关闭旧 PTY（注意 SSH 用 close_remote_terminal_session）
  if (oldCache?.sessionId) {
    invoke("close_remote_terminal_session", { sessionId: oldCache.sessionId }).catch(() => {});
  }
  oldCache?.term.dispose();
}

export function destroyRemoteCache(key: string) {
  const resolved = resolveRemoteCacheKey(key);
  if (!resolved) return;
  const cache = remoteTerminalCache.get(resolved);
  if (!cache) return;
  cache.unlisten?.();
  cache.inputController?.dispose();
  if (cache.sessionId) {
    invoke("close_remote_terminal_session", { sessionId: cache.sessionId }).catch(() => {});
  }
  cache.term.dispose();
  remoteTerminalCache.delete(resolved);
}

export function destroyRemoteCachesByPrefix(prefix: string) {
  const keys = Array.from(remoteTerminalCache.keys());
  for (const key of keys) {
    if (key === prefix || key.startsWith(prefix + ":")) {
      destroyRemoteCache(key);
    }
  }
}

/** 手动刷新 Remote 终端：关闭 SSH PTY + 销毁缓存 + 触发重建 */
export function refreshRemoteTerminal(key: string) {
  const resolved = resolveRemoteCacheKey(key);
  if (!resolved) return;
  const cache = remoteTerminalCache.get(resolved);
  if (!cache) return;
  cache.unlisten?.();
  cache.inputController?.dispose();
  if (cache.sessionId) {
    invoke("close_remote_terminal_session", { sessionId: cache.sessionId }).catch(() => {});
  }
  cache.term.dispose();
  remoteTerminalCache.delete(resolved);
  remoteRebuildCallbacks.get(resolved)?.();
}

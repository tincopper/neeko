import { invoke } from "@tauri-apps/api/core";
import type { TerminalCache } from "./terminalTypes";

// 全局缓存，切换项目时保留会话（key 可为 projectId:tabId:paneId）
export const terminalCache = new Map<string, TerminalCache>();

// 拖拽结束 flag：下一次 ResizeObserver 触发时需要同时做 PTY resize
export let pendingPtyResize = false;
export function setPendingPtyResize(v: boolean) {
  pendingPtyResize = v;
}

// 存储每个 cacheKey 对应的"需要重建"回调，管道关闭时调用
export const terminalRebuildCallbacks = new Map<string, () => void>();

// 存储每个 cacheKey 对应的 DOM wrapper，供命令式切换 Agent 时使用
export const terminalWrapperRefs = new Map<string, HTMLDivElement>();

// 模块级：记录哪些 cacheKey 已经执行过 agent，生命周期与 terminalCache 绑定
// 不放在组件 state/ref 中，避免 unmount/remount 时丢失已执行标记
export const executedAgentKeys = new Set<string>();

export function terminalCacheKey(
  projectId: string,
  tabId?: string | null,
  paneId = "p1",
) {
  return tabId ? `${projectId}:${tabId}:${paneId}` : `${projectId}:${paneId}`;
}

export function log(msg: string) {
  const ts = new Date().toLocaleTimeString();
  console.debug(`[${ts}] [Terminal] ${msg}`);
}

export function destroyTerminalCache(cacheKey: string) {
  const cache = terminalCache.get(cacheKey);
  if (!cache) {
    return;
  }

  if (cache.sessionId) {
    invoke("close_terminal_session", { sessionId: cache.sessionId }).catch(() => {});
  }

  cache.unlistenOutput?.();
  cache.unlistenClosed?.();
  cache.term.dispose();

  terminalCache.delete(cacheKey);
  terminalRebuildCallbacks.delete(cacheKey);
  terminalWrapperRefs.delete(cacheKey);
  executedAgentKeys.delete(cacheKey);
  log(`Cache destroyed for ${cacheKey}`);
}

export function destroyTerminalCachesByPrefix(prefix: string) {
  const keys = Array.from(terminalCache.keys());
  for (const key of keys) {
    if (key === prefix || key.startsWith(`${prefix}:`)) {
      destroyTerminalCache(key);
    }
  }
}

/** 手动刷新终端：关闭后端 PTY + 销毁前端缓存 + 触发重建 */
export function refreshTerminal(projectId: string) {
  let resolvedKey = projectId;
  if (!terminalCache.has(projectId)) {
    for (const key of terminalCache.keys()) {
      if (key.startsWith(`${projectId}:`)) {
        resolvedKey = key;
        break;
      }
    }
  }

  const cache = terminalCache.get(resolvedKey);
  if (!cache) {
    return;
  }

  const { sessionId, unlistenOutput, unlistenClosed } = cache;
  unlistenOutput?.();
  unlistenClosed?.();

  if (sessionId) {
    invoke("close_terminal_session", { sessionId }).catch(() => {});
  }

  destroyTerminalCache(resolvedKey);
  terminalRebuildCallbacks.get(resolvedKey)?.();
}

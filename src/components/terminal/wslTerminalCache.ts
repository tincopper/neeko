import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import type { TerminalInputController } from "./terminalInput";

export interface WslTerminalCache {
   term: Terminal;
   fitAddon: FitAddon;
   element: HTMLElement;
   sessionId: string | null;
   unlisten: (() => void) | null;
   inputController: TerminalInputController | null;
}

// 全局缓存：key = "wsl:{distro}:{projectId}"
export const wslTerminalCache = new Map<string, WslTerminalCache>();

/** WSL 终端重建回调注册表 */
export const wslRebuildCallbacks = new Map<string, () => void>();

/** DOM wrapper 节点注册表，供 switchAgentInWslTerminal 使用 */
export const wslWrapperRefs = new Map<string, HTMLDivElement>();

export function wslCacheKey(distro: string, projectId: string) {
   return `wsl:${distro}:${projectId}`;
}

function resolveWslCacheKey(keyOrPrefix: string): string | null {
   if (wslTerminalCache.has(keyOrPrefix)) return keyOrPrefix;
   for (const key of wslTerminalCache.keys()) {
      if (key.startsWith(keyOrPrefix + ":")) {
         return key;
      }
   }
   return null;
}

function parseProjectIdFromWslKey(key: string): string | null {
   const withWorktree = key.match(/^wsl:.+:([^:]+):wt:[^:]+:p\d+$/);
   if (withWorktree) return withWorktree[1];
   const normal = key.match(/^wsl:.+:([^:]+):p\d+$/);
   if (normal) return normal[1];
   return null;
}

export function destroyWslCache(key: string) {
   const resolved = resolveWslCacheKey(key);
   if (!resolved) return;
   const cache = wslTerminalCache.get(resolved);
   if (!cache) return;
   cache.unlisten?.();
   cache.inputController?.dispose();
   // 通知后端关闭 PTY session，释放子进程
   if (cache.sessionId) {
      invoke("close_terminal_session", { sessionId: cache.sessionId }).catch(() => { });
   }
   cache.term.dispose();
   wslTerminalCache.delete(resolved);
}

export function destroyWslCachesByPrefix(prefix: string) {
   const keys = Array.from(wslTerminalCache.keys());
   for (const key of keys) {
      if (key === prefix || key.startsWith(prefix + ":")) {
         destroyWslCache(key);
      }
   }
}

/** 手动刷新 WSL 终端：关闭 PTY + 销毁缓存 + 触发重建 */
export function refreshWslTerminal(key: string) {
   const resolved = resolveWslCacheKey(key);
   if (!resolved) return;
   const cache = wslTerminalCache.get(resolved);
   if (!cache) return;
   cache.unlisten?.();
   cache.inputController?.dispose();
   if (cache.sessionId) {
      invoke("close_terminal_session", { sessionId: cache.sessionId }).catch(() => { });
   }
   cache.term.dispose();
   wslTerminalCache.delete(resolved);
   // 通过 rebuildCallbackMap 触发重建（需要组件注册）
   wslRebuildCallbacks.get(resolved)?.();
}

/** 获取已建立的 WSL 终端 sessionId（尚未建立返回 null） */
export function getWslSessionId(key: string): string | null {
   return wslTerminalCache.get(key)?.sessionId ?? null;
}

/** 已有活跃终端会话的项目 ID 集合（同一个 distro 下） */
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

/** 向已有 WSL 终端会话发送 agent 命令（Ctrl+C 中断当前进程后重新启动） */
export function launchAgentInWslTerminal(cacheKey: string, command: string, args: string[]) {
   const resolved = resolveWslCacheKey(cacheKey);
   if (!resolved) return;
   const cache = wslTerminalCache.get(resolved);
   if (!cache?.sessionId) return;
   const sessionId = cache.sessionId;
   const ctrlC = Array.from(new TextEncoder().encode("\x03"));
   emit(`terminal-input-${sessionId}`, ctrlC).catch(() => { });
   setTimeout(() => {
      const cmdStr = [command, ...args].join(" ") + "\r";
      const bytes = Array.from(new TextEncoder().encode(cmdStr));
      emit(`terminal-input-${sessionId}`, bytes).catch(() => { });
   }, 50);
}

/**
 * 即时切换 WSL Agent：清除旧 PTY 缓存 + 触发重建，后台异步关闭旧 PTY。
 * 组件重建时会读取最新的 selectedAgentId prop 自动启动新 Agent。
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
   const resolved = resolveWslCacheKey(cacheKey) ?? cacheKey;
   const wrapper = wslWrapperRefs.get(resolved);
   if (!wrapper) {
      // 回退：wrapper 未就绪，用旧路径
      const agent = await invoke<{ id: string; command: string; args: string[] }>(
         "get_agent", { agentId },
      ).catch(() => null);
      if (agent) {
         const cmd = agentCommandOverrides?.[agent.id] ?? agent.command;
         launchAgentInWslTerminal(cacheKey, cmd, agent.args);
      }
      return;
   }

   // 1. 摘除旧缓存事件监听，防止 terminal-closed 触发意外重建
   const oldCache = wslTerminalCache.get(resolved);
   if (oldCache) {
      oldCache.unlisten?.();
      oldCache.inputController?.dispose();
   }

   // 2. 删除旧条目（槽位空出，重建时填入新实例）
   wslTerminalCache.delete(resolved);

   // 3. 清空 wrapper DOM
   while (wrapper.firstChild) {
      wrapper.removeChild(wrapper.firstChild);
   }

   // 4. 触发重建（selectedAgentId 已由 handleSelectWslAgent 更新到 props）
   wslRebuildCallbacks.get(resolved)?.();

   // 5. 后台异步关闭旧 PTY
   if (oldCache?.sessionId) {
      invoke("close_terminal_session", { sessionId: oldCache.sessionId }).catch(() => { });
   }
   oldCache?.term.dispose();
}

/** 所有已有活跃终端会话的项目 ID 集合（跨所有 distro） */
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

import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { listen } from "@tauri-apps/api/event";
import { emit } from "@tauri-apps/api/event";
import { AgentConfig } from "../../types";
import { buildFontFamily } from "../../utils/terminal";
import { useAppContext } from "../../context/app-context";
import { useWslContext } from "../../contexts";

interface WslTerminalCache {
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  sessionId: string | null;
  unlisten: (() => void) | null;
}

// 全局缓存：key = "wsl:{distro}:{projectId}"
export const wslTerminalCache = new Map<string, WslTerminalCache>();

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
  // 通知后端关闭 PTY session，释放子进程
  if (cache.sessionId) {
    invoke("close_terminal_session", { sessionId: cache.sessionId }).catch(() => {});
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
  if (cache.sessionId) {
    invoke("close_terminal_session", { sessionId: cache.sessionId }).catch(() => {});
  }
  cache.term.dispose();
  wslTerminalCache.delete(resolved);
  // 通过 rebuildCallbackMap 触发重建（需要组件注册）
  wslRebuildCallbacks.get(resolved)?.();
}

/** WSL 终端重建回调注册表 */
export const wslRebuildCallbacks = new Map<string, () => void>();

/** DOM wrapper 节点注册表，供 switchAgentInWslTerminal 使用 */
export const wslWrapperRefs = new Map<string, HTMLDivElement>()

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
  emit(`terminal-input-${sessionId}`, ctrlC).catch(() => {});
  setTimeout(() => {
    const cmdStr = [command, ...args].join(" ") + "\r";
    const bytes = Array.from(new TextEncoder().encode(cmdStr));
    emit(`terminal-input-${sessionId}`, bytes).catch(() => {});
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
  const resolved = resolveWslCacheKey(cacheKey) ?? cacheKey
  const wrapper = wslWrapperRefs.get(resolved)
  if (!wrapper) {
    // 回退：wrapper 未就绪，用旧路径
    const agent = await invoke<{ id: string; command: string; args: string[] }>(
      'get_agent', { agentId }
    ).catch(() => null)
    if (agent) {
      const cmd = agentCommandOverrides?.[agent.id] ?? agent.command
      launchAgentInWslTerminal(cacheKey, cmd, agent.args)
    }
    return
  }

  // 1. 摘除旧缓存事件监听，防止 terminal-closed 触发意外重建
  const oldCache = wslTerminalCache.get(resolved)
  if (oldCache) {
    oldCache.unlisten?.()
  }

  // 2. 删除旧条目（槽位空出，重建时填入新实例）
  wslTerminalCache.delete(resolved)

  // 3. 清空 wrapper DOM
  while (wrapper.firstChild) {
    wrapper.removeChild(wrapper.firstChild)
  }

  // 4. 触发重建（selectedAgentId 已由 handleSelectWslAgent 更新到 props）
  wslRebuildCallbacks.get(resolved)?.()

  // 5. 后台异步关闭旧 PTY
  if (oldCache?.sessionId) {
    invoke('close_terminal_session', { sessionId: oldCache.sessionId }).catch(() => {})
  }
  oldCache?.term.dispose()
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

interface WSLTerminalViewProps {
  paneId?: string;
}

export default React.memo(function WSLTerminalView({
  paneId = "p1",
}: WSLTerminalViewProps) {
  const { config } = useAppContext();
  const { activeWslProject, activeWslWorktreePath, setWslOpenSessions } = useWslContext();

  const distro = activeWslProject?.distro ?? null;
  const projectId = activeWslProject?.project.id ?? null;
  const projectPath = activeWslWorktreePath ?? activeWslProject?.project.path ?? "";
  const fontSize = config.terminalFontSize;
  const fontFamily = config.fontFamily;
  const selectedAgentId = activeWslProject?.project.selected_agent ?? null;
  const cacheKeySuffix = activeWslWorktreePath
    ? `:wt:${btoa(activeWslWorktreePath).replace(/=/g, "")}`
    : "";

  const onSessionReady = useCallback(
    (pid: string) => {
      setWslOpenSessions((prev) => new Set(prev).add(pid));
    },
    [setWslOpenSessions],
  );

  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentKeyRef = useRef<string | null>(null);
  const [rebuildCount, setRebuildCount] = useState(0);
  const [ready, setReady] = useState(false);

  // 字体変化时同步到已有实例
  useEffect(() => {
    if (!distro || !projectId) return;
    const key = `${wslCacheKey(distro, projectId)}${cacheKeySuffix}:${paneId}`;
    const cache = wslTerminalCache.get(key);
    if (!cache) return;
    cache.term.options.fontSize = fontSize;
    cache.term.options.fontFamily = buildFontFamily(fontFamily);
    cache.fitAddon.fit();
  }, [fontSize, fontFamily, distro, projectId, cacheKeySuffix, paneId]);

  useEffect(() => {
    if (!distro || !projectId) return;

    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const key = `${wslCacheKey(distro, projectId)}${cacheKeySuffix}:${paneId}`;
    currentKeyRef.current = key;
    setReady(false);

    // 注册重建回调
    wslRebuildCallbacks.set(key, () => {
      if (currentKeyRef.current === key) setRebuildCount(c => c + 1);
    });
    if (wrapperRef.current) {
      wslWrapperRefs.set(key, wrapperRef.current)
    }

    const attach = (cache: WslTerminalCache) => {
      if (!wrapper.contains(cache.element)) {
        wrapper.appendChild(cache.element);
      }
      requestAnimationFrame(() => {
        if (currentKeyRef.current !== key) return;
        cache.fitAddon.fit();
        if (cache.sessionId) {
          invoke("resize_terminal", {
            sessionId: cache.sessionId,
            cols: cache.term.cols,
            rows: cache.term.rows,
          }).catch(() => {});
        }
        cache.term.focus();
      });
    };

    const detachAll = () => {
      while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
    };

    detachAll();

    const existingCache = wslTerminalCache.get(key);
    if (existingCache) {
      const cache = existingCache;
      setReady(!!cache.sessionId);
      attach(cache);
    } else {
      // 新建终端
      const element = document.createElement("div");
      element.style.width = "100%";
      element.style.height = "100%";

      const cssVar = (name: string) =>
        getComputedStyle(document.documentElement).getPropertyValue(name).trim();

      const term = new Terminal({
        cursorBlink: true,
        fontSize,
        fontFamily: buildFontFamily(fontFamily),
        theme: {
          background: cssVar("--bg-primary") || "#000000",
          foreground: cssVar("--text-primary") || "#ededed",
          cursor: cssVar("--accent-blue") || "#ffffff",
          selectionBackground: cssVar("--terminal-selection") || "#333333",
          selectionForeground: cssVar("--text-primary") || "#ededed",
          black: "#000000", red: "#e06c75", green: "#98c379", yellow: "#e5c07b",
          blue: "#61afef", magenta: "#c678dd", cyan: "#56b6c2", white: "#abb2bf",
          brightBlack: "#5c6370", brightRed: "#e06c75", brightGreen: "#98c379",
          brightYellow: "#e5c07b", brightBlue: "#61afef", brightMagenta: "#c678dd",
          brightCyan: "#56b6c2", brightWhite: "#ffffff",
        },
        scrollback: 10000,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      const unicode11 = new Unicode11Addon();
      term.loadAddon(unicode11);
      term.unicode.activeVersion = "11";

      wrapper.appendChild(element);
      term.open(element);
      fitAddon.fit();

      const cache: WslTerminalCache = { term, fitAddon, element, sessionId: null, unlisten: null };
      wslTerminalCache.set(key, cache);

      term.write(`\x1b[33m[WSL] Connecting to ${distro}:${projectPath}...\x1b[0m\r\n`);

      (async () => {
        try {
          const session = await invoke<{ id: string }>("create_wsl_terminal_session", {
            distro,
            projectPath,
            cols: term.cols,
            rows: term.rows,
          });

          if (currentKeyRef.current !== key) return;
          cache.sessionId = session.id;
          setReady(true);
          onSessionReady(projectId);

          // 自动启动 Agent（WSL shell 启动较慢，延迟 500ms 确保 shell 就绪）
          if (selectedAgentId) {
            setTimeout(async () => {
              if (!cache.sessionId) return;
              try {
                const agent = await invoke<AgentConfig>("get_agent", { agentId: selectedAgentId });
                const cmdStr = [agent.command, ...agent.args].join(" ") + "\r";
                const bytes = Array.from(new TextEncoder().encode(cmdStr));
                emit(`terminal-input-${cache.sessionId}`, bytes).catch(() => {});
              } catch (err) {
                console.error("[WSL] Auto-launch agent failed:", err);
              }
            }, 500);
          }

          // 监听输出
          const unlisten = await listen<number[]>(`terminal-output-${session.id}`, (event) => {
            const bytes = new Uint8Array(event.payload);
            term.write(bytes);
          });
          cache.unlisten = unlisten;

          // 输入 → 后端
          term.onData((data) => {
            if (!cache.sessionId) return;
            const bytes = Array.from(new TextEncoder().encode(data));
            emit(`terminal-input-${cache.sessionId}`, bytes).catch(() => {});
          });

          requestAnimationFrame(() => {
            if (currentKeyRef.current !== key) return;
            fitAddon.fit();
            invoke("resize_terminal", {
              sessionId: session.id,
              cols: term.cols,
              rows: term.rows,
            }).catch(() => {});
            term.focus();
          });
        } catch (err) {
          if (currentKeyRef.current !== key) return;
          setReady(true);
          term.write(`\x1b[31m[WSL] Failed to connect: ${err}\x1b[0m\r\n`);
        }
      })();
    }

    const handleResize = () => {
      const cache = wslTerminalCache.get(key);
      if (!cache) return;
      cache.fitAddon.fit();
      if (cache.sessionId) {
        invoke("resize_terminal", {
          sessionId: cache.sessionId,
          cols: cache.term.cols,
          rows: cache.term.rows,
        }).catch(() => {});
      }
    };
    window.addEventListener("resize", handleResize);
    let resizeRafId: number | null = null;
    let prevCols = 0;
    let prevRows = 0;
    const ro = new ResizeObserver(() => {
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = null;
        const c = wslTerminalCache.get(key);
        if (!c) return;
        c.fitAddon.fit();
        if (c.sessionId && (c.term.cols !== prevCols || c.term.rows !== prevRows)) {
          prevCols = c.term.cols;
          prevRows = c.term.rows;
          invoke("resize_terminal", {
            sessionId: c.sessionId,
            cols: c.term.cols,
            rows: c.term.rows,
          }).catch(() => {});
        }
      });
    });
    ro.observe(wrapper);

    return () => {
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      ro.disconnect();
      window.removeEventListener("resize", handleResize);
      detachAll();
      wslRebuildCallbacks.delete(key);
      wslWrapperRefs.delete(key);
    };
  }, [distro, projectId, projectPath, cacheKeySuffix, paneId, rebuildCount]);

  if (!activeWslProject) {
    return null;
  }

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden min-w-0">
      {!ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-primary text-text-secondary text-[var(--terminal-font-size)]">
          Connecting...
        </div>
      )}
      <div className="flex-1 p-0 bg-bg-primary overflow-hidden min-w-0 min-h-0" ref={wrapperRef} />
    </div>
  );
});

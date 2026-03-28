import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { Unicode11Addon } from "xterm-addon-unicode11";
import { listen } from "@tauri-apps/api/event";
import { emit } from "@tauri-apps/api/event";
import { AuthMethod, AgentConfig } from "../../types";
import { buildFontFamily } from "../../utils/terminal";
import "xterm/css/xterm.css";

interface RemoteTerminalCache {
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  sessionId: string | null;
  unlisten: (() => void) | null;
}

// 全局缓存：key = "remote:{entryId}:{projectId}"
const remoteTerminalCache = new Map<string, RemoteTerminalCache>();

export function remoteCacheKey(entryId: string, projectId: string) {
  return `remote:${entryId}:${projectId}`;
}

/** 向已有 SSH 终端会话发送 agent 命令（Ctrl+C 中断当前进程后重新启动） */
export function launchAgentInRemoteTerminal(cacheKey: string, command: string, args: string[]) {
  const cache = remoteTerminalCache.get(cacheKey);
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

export function destroyRemoteCache(key: string) {
  const cache = remoteTerminalCache.get(key);
  if (!cache) return;
  cache.unlisten?.();
  if (cache.sessionId) {
    invoke("close_remote_terminal_session", { sessionId: cache.sessionId }).catch(() => {});
  }
  cache.term.dispose();
  remoteTerminalCache.delete(key);
}

interface RemoteTerminalViewProps {
  entryId: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
  fontSize?: number;
  fontFamily?: string;
  /** 终端 SSH 会话建立成功后的回调，参数为 projectId */
  onSessionReady?: (projectId: string) => void;
  /** 会话建立后自动启动的 Agent ID */
  selectedAgentId?: string | null;
  /** cache key 后缀，side terminal 传 ":side" */
  cacheKeySuffix?: string;
  /** side terminal 模式：显示关闭按钮并固定宽度 */
  sideMode?: boolean;
  onClose?: () => void;
  width?: number;
}

export default function RemoteTerminalView({
  entryId,
  projectId,
  projectName: _projectName,
  projectPath,
  host,
  port,
  username,
  auth,
  fontSize = 14,
  fontFamily = "",
  onSessionReady,
  selectedAgentId,
  cacheKeySuffix = "",
  sideMode = false,
  onClose,
  width,
}: RemoteTerminalViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentKeyRef = useRef<string | null>(null);
  const [rebuildCount, _setRebuildCount] = useState(0);

  // 字体变化时同步到已有实例
  useEffect(() => {
    const key = remoteCacheKey(entryId, projectId) + cacheKeySuffix;
    const cache = remoteTerminalCache.get(key);
    if (!cache) return;
    cache.term.options.fontSize = fontSize;
    cache.term.options.fontFamily = buildFontFamily(fontFamily);
    cache.fitAddon.fit();
  }, [fontSize, fontFamily, entryId, projectId]);

  // side terminal 宽度变化时重算 PTY 尺寸（rerender-split-combined-hooks）
  useEffect(() => {
    const key = remoteCacheKey(entryId, projectId) + cacheKeySuffix;
    const cache = remoteTerminalCache.get(key);
    if (!cache) return;
    const timer = setTimeout(() => {
      cache.fitAddon.fit();
      if (cache.sessionId) {
        invoke("resize_remote_terminal", {
          sessionId: cache.sessionId,
          cols: cache.term.cols,
          rows: cache.term.rows,
        }).catch(() => {});
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [width]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const key = remoteCacheKey(entryId, projectId) + cacheKeySuffix;
    currentKeyRef.current = key;

    const attach = (cache: RemoteTerminalCache) => {
      if (!wrapper.contains(cache.element)) {
        wrapper.appendChild(cache.element);
      }
      requestAnimationFrame(() => {
        if (currentKeyRef.current !== key) return;
        cache.fitAddon.fit();
        if (cache.sessionId) {
          invoke("resize_remote_terminal", {
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

    if (remoteTerminalCache.has(key)) {
      attach(remoteTerminalCache.get(key)!);
    } else {
      // 新建终端
      const element = document.createElement("div");
      element.style.width = "100%";
      element.style.height = "100%";

      const term = new Terminal({
        cursorBlink: true,
        fontSize,
        fontFamily: buildFontFamily(fontFamily),
        theme: {
          background: "#282c34",
          foreground: "#abb2bf",
          cursor: "#528bff",
          selectionBackground: "#3e4451",
          black: "#282c34", red: "#e06c75", green: "#98c379", yellow: "#e5c07b",
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

      const cache: RemoteTerminalCache = { term, fitAddon, element, sessionId: null, unlisten: null };
      remoteTerminalCache.set(key, cache);

      term.write(`\x1b[33m[SSH] Connecting to ${username}@${host}:${port}${projectPath}...\x1b[0m\r\n`);

      (async () => {
        try {
          const session = await invoke<{ id: string }>("create_remote_terminal_session", {
            host,
            port,
            username,
            auth,
            projectPath,
            cols: term.cols,
            rows: term.rows,
          });

          if (currentKeyRef.current !== key) return;
          cache.sessionId = session.id;
          onSessionReady?.(projectId);

          // 自动启动 Agent（SSH shell 初始化较慢，延迟 800ms 确保 shell 就绪）
          if (selectedAgentId) {
            setTimeout(async () => {
              if (!cache.sessionId) return;
              try {
                const agent = await invoke<AgentConfig>("get_agent", { agentId: selectedAgentId });
                const cmdStr = [agent.command, ...agent.args].join(" ") + "\r";
                const bytes = Array.from(new TextEncoder().encode(cmdStr));
                emit(`terminal-input-${cache.sessionId}`, bytes).catch(() => {});
              } catch (err) {
                console.error("[SSH] Auto-launch agent failed:", err);
              }
            }, 800);
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
            invoke("resize_remote_terminal", {
              sessionId: session.id,
              cols: term.cols,
              rows: term.rows,
            }).catch(() => {});
            term.focus();
          });
        } catch (err) {
          if (currentKeyRef.current !== key) return;
          term.write(`\x1b[31m[SSH] Failed to connect: ${err}\x1b[0m\r\n`);
        }
      })();
    }

    const handleResize = () => {
      const cache = remoteTerminalCache.get(key);
      if (!cache) return;
      cache.fitAddon.fit();
      if (cache.sessionId) {
        invoke("resize_remote_terminal", {
          sessionId: cache.sessionId,
          cols: cache.term.cols,
          rows: cache.term.rows,
        }).catch(() => {});
      }
    };
    window.addEventListener("resize", handleResize);
    // 监听容器尺寸变化（side terminal 拖拽时主终端宽度变化也会触发）
    const ro = new ResizeObserver(() => handleResize());
    ro.observe(wrapper);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", handleResize);
      detachAll();
    };
  }, [entryId, projectId, projectPath, cacheKeySuffix, rebuildCount]);

  if (sideMode) {
    return (
      <div
        className="side-terminal-container"
        style={width ? { flex: "none", width } : undefined}
      >
        <div className="side-terminal-header">
          <span className="side-terminal-title">Terminal</span>
          <span className="side-terminal-hint">Ctrl+W to close</span>
          <button className="side-terminal-close" onClick={onClose} title="Close (Ctrl+W)">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="terminal-wrapper" ref={wrapperRef} />
      </div>
    );
  }

  return (
    <div className="terminal-container">
      <div className="terminal-wrapper" ref={wrapperRef} />
    </div>
  );
}

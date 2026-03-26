import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { Unicode11Addon } from "xterm-addon-unicode11";
import { listen } from "@tauri-apps/api/event";
import { emit } from "@tauri-apps/api/event";
import "xterm/css/xterm.css";

const isLinux = navigator.platform.toLowerCase().startsWith("linux");
const DEFAULT_FONT_FAMILY = isLinux
  ? "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace"
  : "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";

interface WslTerminalCache {
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  sessionId: string | null;
  unlisten: (() => void) | null;
}

// 全局缓存：key = "wsl:{distro}:{projectId}"
const wslTerminalCache = new Map<string, WslTerminalCache>();

export function wslCacheKey(distro: string, projectId: string) {
  return `wsl:${distro}:${projectId}`;
}

export function destroyWslCache(key: string) {
  const cache = wslTerminalCache.get(key);
  if (!cache) return;
  cache.unlisten?.();
  // 通知后端关闭 PTY session，释放子进程
  if (cache.sessionId) {
    invoke("close_terminal_session", { sessionId: cache.sessionId }).catch(() => {});
  }
  cache.term.dispose();
  wslTerminalCache.delete(key);
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
      const projectId = key.slice(`wsl:${distro}:`.length);
      result.add(projectId);
    }
  }
  return result;
}

/** 所有已有活跃终端会话的项目 ID 集合（跨所有 distro） */
export function getAllWslOpenProjectIds(): Set<string> {
  const result = new Set<string>();
  for (const [key, cache] of wslTerminalCache.entries()) {
    if (key.startsWith("wsl:") && cache.sessionId) {
      // key format: wsl:{distro}:{projectId}  — distro may contain colons
      // We stored it as wslCacheKey(distro, projectId) = `wsl:${distro}:${projectId}`
      // Find the last colon that separates projectId
      const withoutPrefix = key.slice(4); // remove "wsl:"
      const lastColon = withoutPrefix.lastIndexOf(":");
      if (lastColon >= 0) {
        result.add(withoutPrefix.slice(lastColon + 1));
      }
    }
  }
  return result;
}

interface WSLTerminalViewProps {
  distro: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  fontSize?: number;
  fontFamily?: string;
  /** 终端 PTY 会话建立成功后的回调，参数为 projectId */
  onSessionReady?: (projectId: string) => void;
}

export default function WSLTerminalView({
  distro,
  projectId,
  projectName,
  projectPath,
  fontSize = 14,
  fontFamily = "",
  onSessionReady,
}: WSLTerminalViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentKeyRef = useRef<string | null>(null);
  const [rebuildCount, _setRebuildCount] = useState(0);

  // 字体变化时同步到已有实例
  useEffect(() => {
    const key = wslCacheKey(distro, projectId);
    const cache = wslTerminalCache.get(key);
    if (!cache) return;
    cache.term.options.fontSize = fontSize;
    cache.term.options.fontFamily = fontFamily
      ? `'${fontFamily}', ${DEFAULT_FONT_FAMILY}`
      : DEFAULT_FONT_FAMILY;
    cache.fitAddon.fit();
  }, [fontSize, fontFamily, distro, projectId]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const key = wslCacheKey(distro, projectId);
    currentKeyRef.current = key;

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

    if (wslTerminalCache.has(key)) {
      attach(wslTerminalCache.get(key)!);
    } else {
      // 新建终端
      const element = document.createElement("div");
      element.style.width = "100%";
      element.style.height = "100%";

      const term = new Terminal({
        cursorBlink: true,
        fontSize,
        fontFamily: fontFamily ? `'${fontFamily}', ${DEFAULT_FONT_FAMILY}` : DEFAULT_FONT_FAMILY,
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
          onSessionReady?.(projectId);

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

    return () => {
      window.removeEventListener("resize", handleResize);
      detachAll();
    };
  }, [distro, projectId, projectPath, rebuildCount]);

  // 终端标题
  const title = `${projectName} [WSL: ${distro}]`;

  return (
    <div className="terminal-container">
      <div className="side-terminal-header">
        <span className="wsl-distro-icon" style={{ fontSize: 13 }}>🐧</span>
        <span className="side-terminal-title">{title}</span>
        <span className="side-terminal-hint">{projectPath}</span>
      </div>
      <div className="terminal-wrapper" ref={wrapperRef} />
    </div>
  );
}

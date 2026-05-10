import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { listen } from "@tauri-apps/api/event";
import { emit } from "@tauri-apps/api/event";
import type { AuthMethod, AgentConfig } from "../../types";
import { buildFontFamily, buildTerminalTheme } from "../../utils/terminal";
import { setupTerminalInput } from "./terminalInput";
import {
  remoteCacheKey,
  remoteRebuildCallbacks,
  remoteTerminalCache,
  remoteWrapperRefs,
  type RemoteTerminalCache,
} from "./terminalCache";
import { useEditorContext } from "../../contexts";

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
  paneId?: string;
  /** cache key 后缀，worktree 终端使用 */
  cacheKeySuffix?: string;
}

export default React.memo(function RemoteTerminalView({
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
  selectedAgentId: _selectedAgentId,
  paneId = "p1",
  cacheKeySuffix = "",
}: RemoteTerminalViewProps) {
  const { activeTabId, tabs } = useEditorContext();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentKeyRef = useRef<string | null>(null);
  const [rebuildCount, setRebuildCount] = useState(0);
  const [ready, setReady] = useState(false);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const tabAgentId = activeTab?.agentId ?? null;

  // 字体变化时同步到已有实例
  useEffect(() => {
    const key = `${remoteCacheKey(entryId, projectId)}${activeTabId ? `:${activeTabId}` : ""}${cacheKeySuffix}:${paneId}`;
    const cache = remoteTerminalCache.get(key);
    if (!cache) return;
    cache.term.options.fontSize = fontSize;
    cache.term.options.fontFamily = buildFontFamily(fontFamily);
    cache.fitAddon.fit();
  }, [fontSize, fontFamily, entryId, projectId, cacheKeySuffix, paneId, activeTabId]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const key = `${remoteCacheKey(entryId, projectId)}${activeTabId ? `:${activeTabId}` : ""}${cacheKeySuffix}:${paneId}`;
    currentKeyRef.current = key;
    setReady(false);

    // 注册重建回调
    remoteRebuildCallbacks.set(key, () => {
      if (currentKeyRef.current === key) setRebuildCount(c => c + 1);
    });
    if (wrapperRef.current) {
      remoteWrapperRefs.set(key, wrapperRef.current)
    }

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

    const existingCache = remoteTerminalCache.get(key);
    if (existingCache) {
      const cache = existingCache;
      setReady(!!cache.sessionId);
      attach(cache);
    } else {
      // 新建终端
      const element = document.createElement("div");
      element.style.width = "100%";
      element.style.height = "100%";

      const term = new Terminal({
        cursorBlink: true,
        fontSize,
        fontFamily: buildFontFamily(fontFamily),
        theme: buildTerminalTheme(),
        scrollback: 10000,
        overviewRuler: { width: 0 },
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

      const cache: RemoteTerminalCache = {
        term,
        fitAddon,
        element,
        sessionId: null,
        unlisten: null,
        inputController: null,
      };
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
          setReady(true);
          onSessionReady?.(projectId);

          // 自动启动 Agent（SSH shell 初始化较慢，延迟 800ms 确保 shell 就绪）
          if (tabAgentId) {
            setTimeout(async () => {
              if (!cache.sessionId) return;
              try {
                const agent = await invoke<AgentConfig>("get_agent", { agentId: tabAgentId });
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
           cache.inputController = setupTerminalInput({
              term,
              sendInput: (text: string) => {
                 if (!cache.sessionId) return;
                 const bytes = Array.from(new TextEncoder().encode(text));
                 emit(`terminal-input-${cache.sessionId}`, bytes).catch(() => {});
              },
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
          setReady(true);
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
    let resizeRafId: number | null = null;
    let prevCols = 0;
    let prevRows = 0;
    const ro = new ResizeObserver(() => {
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = null;
        const c = remoteTerminalCache.get(key);
        if (!c) return;
        c.fitAddon.fit();
        if (c.sessionId && (c.term.cols !== prevCols || c.term.rows !== prevRows)) {
          prevCols = c.term.cols;
          prevRows = c.term.rows;
          invoke("resize_remote_terminal", {
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
      remoteRebuildCallbacks.delete(key);
      remoteWrapperRefs.delete(key);
    };
  }, [entryId, projectId, projectPath, cacheKeySuffix, paneId, activeTabId, rebuildCount]);

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
      {!ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-text-secondary text-[var(--terminal-font-size)]">
          Connecting...
        </div>
      )}
      <div className="terminal-wrapper flex-1 p-0 overflow-hidden min-w-0 min-h-0" style={{ backgroundColor: "var(--terminal-bg)" }} ref={wrapperRef} />
    </div>
  );
});

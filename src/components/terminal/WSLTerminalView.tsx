import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { listen } from "@tauri-apps/api/event";
import { emit } from "@tauri-apps/api/event";
import type { AgentConfig } from "../../types";
import { buildFontFamily, buildTerminalTheme } from "../../utils/terminal";
import { setupTerminalInput } from "./terminalInput";
import {
   wslCacheKey,
   wslRebuildCallbacks,
   wslTerminalCache,
   wslWrapperRefs,
   type WslTerminalCache,
} from "./terminalCache";
import { useAppContext, useEditorContext, useWslContext } from "../../contexts";

interface WSLTerminalViewProps {
   paneId?: string;
}

export default React.memo(function WSLTerminalView({
   paneId = "p1",
}: WSLTerminalViewProps) {
   const { config } = useAppContext();
   const { activeTabId, tabs } = useEditorContext();
   const { activeWslProject, activeWslWorktreePath, setWslOpenSessions } = useWslContext();

   const distro = activeWslProject?.distro ?? null;
   const projectId = activeWslProject?.project.id ?? null;
   const projectPath = activeWslWorktreePath ?? activeWslProject?.project.path ?? "";
   const fontSize = config.terminalFontSize;
   const fontFamily = config.fontFamily;
   const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
   const tabAgentId = activeTab?.agentId ?? null;
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
      const key = `${wslCacheKey(distro, projectId)}${activeTabId ? `:${activeTabId}` : ""}${cacheKeySuffix}:${paneId}`;
      const cache = wslTerminalCache.get(key);
      if (!cache) return;
      cache.term.options.fontSize = fontSize;
      cache.term.options.fontFamily = buildFontFamily(fontFamily);
      cache.fitAddon.fit();
   }, [fontSize, fontFamily, distro, projectId, cacheKeySuffix, paneId, activeTabId]);

   useEffect(() => {
      if (!distro || !projectId) return;

      const wrapper = wrapperRef.current;
      if (!wrapper) return;

      const key = `${wslCacheKey(distro, projectId)}${activeTabId ? `:${activeTabId}` : ""}${cacheKeySuffix}:${paneId}`;
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
               }).catch(() => { });
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

         const cache: WslTerminalCache = {
            term,
            fitAddon,
            element,
            sessionId: null,
            unlisten: null,
            inputController: null,
         };
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
               if (tabAgentId) {
                  setTimeout(async () => {
                     if (!cache.sessionId) return;
                     try {
                        const agent = await invoke<AgentConfig>("get_agent", { agentId: tabAgentId });
                        const cmdStr = [agent.command, ...agent.args].join(" ") + "\r";
                        const bytes = Array.from(new TextEncoder().encode(cmdStr));
                        emit(`terminal-input-${cache.sessionId}`, bytes).catch(() => { });
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
                cache.inputController = setupTerminalInput({
                   term,
                   sendInput: (text: string) => {
                      if (!cache.sessionId) return;
                      const bytes = Array.from(new TextEncoder().encode(text));
                      emit(`terminal-input-${cache.sessionId}`, bytes).catch(() => { });
                   },
                });

               requestAnimationFrame(() => {
                  if (currentKeyRef.current !== key) return;
                  fitAddon.fit();
                  invoke("resize_terminal", {
                     sessionId: session.id,
                     cols: term.cols,
                     rows: term.rows,
                  }).catch(() => { });
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
            }).catch(() => { });
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
               }).catch(() => { });
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
   }, [distro, projectId, projectPath, cacheKeySuffix, paneId, activeTabId, rebuildCount]);

   if (!activeWslProject) {
      return null;
   }

   return (
      <div className="relative flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
         {!ready && (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-text-secondary text-[var(--terminal-font-size)]">
               Connecting...
            </div>
         )}
         <div className="terminal-wrapper flex-1 p-0 pl-2 overflow-hidden min-w-0 min-h-0" style={{ backgroundColor: "var(--terminal-bg)" }} ref={wrapperRef} />
      </div>
   );
});

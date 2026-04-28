import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppContext } from "../../contexts";
import {
   createTerminalForProject,
   terminalCache,
   terminalRebuildCallbacks,
   pendingPtyResize,
} from "./TerminalView";
import { buildFontFamily } from "../../utils/terminal";
import { useAppStore } from "../../store/appStore";

// cache key 格式：projectId + ":wt:" + worktreePath
export function worktreeKey(projectId: string, worktreePath: string) {
   return `${projectId}:wt:${worktreePath}`;
}

function WorktreeTerminalView() {
   const activeProject = useAppStore((state) => state.activeProject);
   const activeWorktreePath = useAppStore((state) => state.activeWorktreePath);
   const activeWorktreeBranch = useAppStore((state) => state.activeWorktreeBranch);
   const { config } = useAppContext();

   const wrapperRef = useRef<HTMLDivElement>(null);
   const currentKeyRef = useRef<string | null>(null);
   const [rebuildCount, setRebuildCount] = useState(0);

   const projectId = activeProject?.id ?? null;
   const projectName = activeProject?.name ?? "";
   const selectedAgent = activeProject?.selected_agent ?? null;
   const worktreePath = activeWorktreePath;
   const worktreeBranch = activeWorktreeBranch;
   const fontSize = config.terminalFontSize;
   const shell = config.shell;
   const fontFamily = config.fontFamily;

   // fontSize / fontFamily 变化时同步到已有实例
   useEffect(() => {
      if (!projectId || !worktreePath) return;
      const key = worktreeKey(projectId, worktreePath);
      const cache = terminalCache.get(key);
      if (!cache) return;
      cache.term.options.fontSize = fontSize;
      cache.term.options.fontFamily = buildFontFamily(fontFamily);
      cache.fitAddon.fit();
   }, [fontSize, fontFamily, projectId, worktreePath]);

   useEffect(() => {
      if (!projectId || !worktreePath) return;

      const wrapper = wrapperRef.current;
      if (!wrapper) return;

      const key = worktreeKey(projectId, worktreePath);
      currentKeyRef.current = key;

      // 注册重建回调
      terminalRebuildCallbacks.set(key, () => {
         if (currentKeyRef.current === key) {
            setRebuildCount((c) => c + 1);
         }
      });

      const attach = (cache: ReturnType<typeof terminalCache.get>) => {
         if (!cache) return;
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

      const existingCache = terminalCache.get(key);
      if (existingCache) {
         attach(existingCache);
      } else {
         // worktreePath 作为终端工作目录，selectedAgent 自动启动 Agent，backendProjectId 为父项目 ID
         createTerminalForProject(
            key,
            worktreePath,
            `${projectName} [${worktreeBranch}]`,
            selectedAgent,
            fontSize,
            wrapper,
            shell,
            fontFamily,
            projectId,
         ).then((cache) => {
            if (currentKeyRef.current !== key) return;
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
         });
      }

      const handleResize = () => {
         const cache = terminalCache.get(key);
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

      // 监听容器尺寸变化：平时只做 fit，拖拽结束后第一次触发时额外做 PTY resize
      let resizeRafId: number | null = null;
      const ro = new ResizeObserver(() => {
         if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
         resizeRafId = requestAnimationFrame(() => {
            resizeRafId = null;
            const c = terminalCache.get(key);
            if (!c) return;
            c.fitAddon.fit();
            if (pendingPtyResize && c.sessionId) {
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
         terminalRebuildCallbacks.delete(key);
      };
   }, [projectId, worktreePath, rebuildCount]);

   if (!activeProject || !worktreePath) {
      return null;
   }

   return (
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
         <div className="flex-1 p-0 overflow-hidden min-w-0 min-h-0" style={{ backgroundColor: "var(--terminal-bg)" }} ref={wrapperRef} />
      </div>
   );
}

export default React.memo(WorktreeTerminalView);

import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  createTerminalForProject,
  terminalCache,
  terminalRebuildCallbacks,
  pendingPtyResize,
} from "./TerminalView";
import { buildFontFamily } from "../../utils/terminal";

interface WorktreeTerminalViewProps {
  projectId: string;
  projectName: string;
  worktreePath: string;
  worktreeBranch: string;
  selectedAgent: string | null;
  fontSize?: number;
  shell?: string;
  fontFamily?: string;
}

// cache key 鏍煎紡锛歱rojectId + ":wt:" + worktreePath
export function worktreeKey(projectId: string, worktreePath: string) {
  return `${projectId}:wt:${worktreePath}`;
}

function WorktreeTerminalView({
  projectId,
  projectName,
  worktreePath,
  worktreeBranch,
  selectedAgent,
  fontSize = 14,
  shell = "",
  fontFamily = "",
}: WorktreeTerminalViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentKeyRef = useRef<string | null>(null);
  const [rebuildCount, setRebuildCount] = useState(0);

  // fontSize / fontFamily 鍙樺寲鏃跺悓姝ュ埌宸叉湁瀹炰緥
  useEffect(() => {
    const key = worktreeKey(projectId, worktreePath);
    const cache = terminalCache.get(key);
    if (!cache) return;
    cache.term.options.fontSize = fontSize;
    cache.term.options.fontFamily = buildFontFamily(fontFamily);
    cache.fitAddon.fit();
  }, [fontSize, fontFamily, projectId, worktreePath]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const key = worktreeKey(projectId, worktreePath);
    currentKeyRef.current = key;

    // 娉ㄥ唽閲嶅缓鍥炶皟
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
          }).catch(() => {});
        }
        cache.term.focus();
      });
    };

    const detachAll = () => {
      while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
    };

    detachAll();

    if (terminalCache.has(key)) {
      attach(terminalCache.get(key)!);
    } else {
      // worktreePath 浣滀负缁堢宸ヤ綔鐩綍锛宻electedAgent 鑷姩鍚姩 Agent锛宐ackendProjectId 涓虹埗椤圭洰 ID
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
            }).catch(() => {});
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
        }).catch(() => {});
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
      terminalRebuildCallbacks.delete(key);
    };
  }, [projectId, worktreePath, rebuildCount]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      <div className="flex-1 p-0 bg-bg-primary overflow-hidden min-w-0 min-h-0" ref={wrapperRef} />
    </div>
  );
}

export default React.memo(WorktreeTerminalView);

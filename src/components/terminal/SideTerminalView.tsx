import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  createTerminalForProject,
  terminalCache,
  terminalRebuildCallbacks,
  destroyTerminalCache,
} from "./TerminalView";
import { buildFontFamily } from "../../utils/terminal";
import { CloseRoundIcon } from "../icons";

interface Project {
  id: string;
  name: string;
  path: string;
  selected_agent: string | null;
}

interface SideTerminalViewProps {
  project: Project;
  fontSize?: number;
  shell?: string;
  fontFamily?: string;
  onClose: () => void;
  worktreePath?: string;
  index?: number;
  /** 当前打开的终端数量，用于触发布局变化时的 resize */
  terminalCount?: number;
  /** 当前是否聚焦 */
  isFocused?: boolean;
  /** 聚焦时回调 */
  onFocus?: () => void;
  /** 用户主动关闭时调用（销毁 PTY cache）；组件因切换项目而卸载时不触发，保留 PTY 会话 */
  onDestroy?: () => void;
}

// Side 终端的 cache key 格式：projectId + ":side" 或 projectId + ":side:" + index
function sideKey(projectId: string, index?: number, worktreePath?: string) {
  if (worktreePath) {
    return index !== undefined ? `${projectId}:side:${index}:${worktreePath}` : `${projectId}:side:${worktreePath}`;
  }
  return index !== undefined ? `${projectId}:side:${index}` : `${projectId}:side`;
}

/** 手动刷新 Side 终端 */
export function refreshSideTerminal(projectId: string, index?: number, worktreePath?: string) {
  const key = sideKey(projectId, index, worktreePath);
  const cache = terminalCache.get(key);
  if (cache) {
    cache.unlistenOutput?.();
    if (cache.sessionId) {
      invoke('close_terminal_session', { sessionId: cache.sessionId }).catch(() => {});
    }
  }
  destroyTerminalCache(key);
  terminalRebuildCallbacks.get(key)?.();
}

function SideTerminalView({
  project,
  fontSize = 14,
  shell = "",
  fontFamily = "",
  onClose,
  worktreePath,
  index,
  terminalCount,
  isFocused,
  onFocus,
  onDestroy,
}: SideTerminalViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentKeyRef = useRef<string | null>(null);
  const [rebuildCount, setRebuildCount] = useState(0);
  const prevTerminalCountRef = useRef(0);

  // 布局变化时触发 PTY resize（终端数量变化时）
  useEffect(() => {
    if (terminalCount === undefined) return;
    const key = sideKey(project.id, index, worktreePath);
    const cache = terminalCache.get(key);
    // 检测到终端数量变化
    if (prevTerminalCountRef.current !== terminalCount && cache) {
      prevTerminalCountRef.current = terminalCount;
      requestAnimationFrame(() => {
        cache.fitAddon.fit();
        if (cache.sessionId) {
          invoke("resize_terminal", {
            sessionId: cache.sessionId,
            cols: cache.term.cols,
            rows: cache.term.rows,
          }).catch(() => {});
        }
      });
    }
  }, [terminalCount, project.id, index, worktreePath]);

  // fontSize / fontFamily 变化时同步到已有实例
  useEffect(() => {
    const key = sideKey(project.id, index, worktreePath);
    const cache = terminalCache.get(key);
    if (!cache) return;
    cache.term.options.fontSize = fontSize;
    cache.term.options.fontFamily = buildFontFamily(fontFamily);
    cache.fitAddon.fit();
  }, [fontSize, fontFamily, project.id, index, worktreePath]);

  // side terminal 容器尺寸变化时重算 PTY 尺寸（使用 ResizeObserver）
  useEffect(() => {
    const key = sideKey(project.id, index, worktreePath);
    const cache = terminalCache.get(key);
    if (!cache || !wrapperRef.current) return;

    let rafId: number | null = null;
    const ro = new ResizeObserver(() => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const c = terminalCache.get(key);
        if (c) {
          c.fitAddon.fit();
          if (c.sessionId) {
            invoke("resize_terminal", {
              sessionId: c.sessionId,
              cols: c.term.cols,
              rows: c.term.rows,
            }).catch(() => {});
          }
        }
      });
    });
    ro.observe(wrapperRef.current);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [project.id, index, worktreePath]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const key = sideKey(project.id, index, worktreePath);
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
      // 副终端不自动启动 agent；若有 worktreePath 则 cwd 为 worktree 路径
      createTerminalForProject(
        key,
        worktreePath || project.path,
        project.name,
        null,
        fontSize,
        wrapper,
        shell,
        fontFamily,
        project.id,
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

    return () => {
      window.removeEventListener("resize", handleResize);
      detachAll();
      terminalRebuildCallbacks.delete(key);
    };
  }, [project.id, worktreePath, index, rebuildCount]);

  const handleClose = () => {
    onDestroy?.();
    onClose();
  };

  // 当 isFocused 变化时，focus terminal
  useEffect(() => {
    if (isFocused) {
      const key = sideKey(project.id, index, worktreePath);
      const cache = terminalCache.get(key);
      if (cache) {
        cache.term.focus();
        onFocus?.();
      }
    }
  }, [isFocused, project.id, index, worktreePath, onFocus]);

  return (
    <div className="shrink-0 flex flex-col overflow-hidden min-w-0 min-h-0 bg-bg-primary">
      <div className="flex items-center gap-2 p-1 px-2.5 bg-bg-secondary border-b border-border shrink-0 h-7 box-border">
        <span className="text-xs font-medium text-text-secondary">Terminal</span>
        <span className="text-[0.72em] text-text-muted ml-1">Ctrl+W to close</span>
        <button className="ml-auto bg-transparent border-none text-text-muted cursor-pointer p-1 rounded transition-colors duration-150" onClick={handleClose} title="Close (Ctrl+W)">
          <CloseRoundIcon size={12} />
        </button>
      </div>
      <div className="flex-1 p-0 bg-bg-primary overflow-hidden min-w-0 min-h-0" ref={wrapperRef} />
    </div>
  );
}

export default React.memo(SideTerminalView);


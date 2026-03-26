import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  createTerminalForProject,
  terminalCache,
  terminalRebuildCallbacks,
} from "./TerminalView";

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
  width?: number;
  worktreePath?: string;
  /** 用户主动关闭时调用（销毁 PTY cache）；组件因切换项目而卸载时不触发，保留 PTY 会话 */
  onDestroy?: () => void;
}

// Side 终端的 cache key 格式：projectId + ":side" 或 projectId + ":side:" + worktreePath
function sideKey(projectId: string, worktreePath?: string) {
  return worktreePath ? `${projectId}:side:${worktreePath}` : `${projectId}:side`;
}

export default function SideTerminalView({
  project,
  fontSize = 14,
  shell = "",
  fontFamily = "",
  onClose,
  width,
  worktreePath,
  onDestroy,
}: SideTerminalViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentKeyRef = useRef<string | null>(null);
  const [rebuildCount, setRebuildCount] = useState(0);

  // fontSize / fontFamily 变化时同步到已有实例
  useEffect(() => {
    const key = sideKey(project.id, worktreePath);
    const cache = terminalCache.get(key);
    if (!cache) return;
    const { DEFAULT_FONT_FAMILY } = getFontFamily(fontFamily);
    cache.term.options.fontSize = fontSize;
    cache.term.options.fontFamily = fontFamily
      ? `'${fontFamily}', ${DEFAULT_FONT_FAMILY}`
      : DEFAULT_FONT_FAMILY;
    cache.fitAddon.fit();
  }, [fontSize, fontFamily, project.id]);

  // side terminal 宽度变化时重算 PTY 尺寸
  useEffect(() => {
    const key = sideKey(project.id, worktreePath);
    const cache = terminalCache.get(key);
    if (!cache) return;
    // 延迟执行以确保浏览器完成布局
    const timer = setTimeout(() => {
      cache.fitAddon.fit();
      if (cache.sessionId) {
        invoke("resize_terminal", {
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

    const key = sideKey(project.id, worktreePath);
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
  }, [project.id, worktreePath, rebuildCount]);

  const handleClose = () => {
    onDestroy?.();
    onClose();
  };

  return (
    <div
      className="side-terminal-container"
      style={width ? { flex: "none", width } : undefined}
    >
      <div className="side-terminal-header">
        <span className="side-terminal-title">Terminal</span>
        <span className="side-terminal-hint">Ctrl+W to close</span>
        <button className="side-terminal-close" onClick={handleClose} title="Close (Ctrl+W)">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
      <div className="terminal-wrapper" ref={wrapperRef} />
    </div>
  );
}

// 共用默认字体 fallback
function getFontFamily(_fontFamily: string) {
  const isLinux = navigator.platform.toLowerCase().startsWith("linux");
  const DEFAULT_FONT_FAMILY = isLinux
    ? "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace"
    : "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";
  return { DEFAULT_FONT_FAMILY };
}

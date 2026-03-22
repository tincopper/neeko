import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  createTerminalForProject,
  terminalCache,
  terminalRebuildCallbacks,
  destroyTerminalCache,
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
}

// Side 终端的 cache key 格式：projectId + ":side"
function sideKey(projectId: string) {
  return `${projectId}:side`;
}

export default function SideTerminalView({
  project,
  fontSize = 14,
  shell = "",
  fontFamily = "",
  onClose,
}: SideTerminalViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentKeyRef = useRef<string | null>(null);
  const [rebuildCount, setRebuildCount] = useState(0);

  // fontSize / fontFamily 变化时同步到已有实例
  useEffect(() => {
    const key = sideKey(project.id);
    const cache = terminalCache.get(key);
    if (!cache) return;
    const { DEFAULT_FONT_FAMILY } = getFontFamily(fontFamily);
    cache.term.options.fontSize = fontSize;
    cache.term.options.fontFamily = fontFamily
      ? `'${fontFamily}', ${DEFAULT_FONT_FAMILY}`
      : DEFAULT_FONT_FAMILY;
    cache.fitAddon.fit();
  }, [fontSize, fontFamily, project.id]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const key = sideKey(project.id);
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
      // Side 终端不自动启动 agent（selectedAgentId = null）
      // backendProjectId 使用真实的 project.id，而非 cache key
      createTerminalForProject(
        key,
        project.path,
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
  }, [project.id, rebuildCount]);

  // 组件卸载时销毁 side 终端缓存（关闭时彻底清理）
  useEffect(() => {
    return () => {
      const key = sideKey(project.id);
      destroyTerminalCache(key);
    };
  }, [project.id]);

  return (
    <div className="side-terminal-container">
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

// 共用默认字体 fallback
function getFontFamily(_fontFamily: string) {
  const isLinux = navigator.platform.toLowerCase().startsWith("linux");
  const DEFAULT_FONT_FAMILY = isLinux
    ? "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace"
    : "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";
  return { DEFAULT_FONT_FAMILY };
}

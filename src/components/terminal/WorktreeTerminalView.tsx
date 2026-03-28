import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  createTerminalForProject,
  terminalCache,
  terminalRebuildCallbacks,
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

// cache key 格式：projectId + ":wt:" + worktreePath
export function worktreeKey(projectId: string, worktreePath: string) {
  return `${projectId}:wt:${worktreePath}`;
}

export default function WorktreeTerminalView({
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

  // fontSize / fontFamily 变化时同步到已有实例
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
  }, [projectId, worktreePath, rebuildCount]);

  return (
    <div className="terminal-container">
      <div className="terminal-wrapper" ref={wrapperRef} />
    </div>
  );
}

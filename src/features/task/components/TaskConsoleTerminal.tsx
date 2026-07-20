/**
 * PTY host for one TaskConsoleSession — lives in the bottom Console panel.
 */
import React, { useEffect, useMemo, useRef } from "react";

import { useAppContext } from "@/shared/contexts/AppContext";
import { resizeTerminal } from "@/features/terminal/api/terminalApi";
import { createTerminalForProject } from "@/features/terminal/components/terminalFactory";
import {
  destroyTerminalCache,
  terminalCache,
  terminalRebuildCallbacks,
  terminalWrapperRefs,
} from "@/features/terminal/components/terminalCache";

import { taskConsoleCacheKey, useTaskStore } from "../store";
import type { TaskConsoleSession } from "../types";

interface Props {
  session: TaskConsoleSession;
  active: boolean;
}

function TaskConsoleTerminal({ session, active }: Props) {
  const { config } = useAppContext();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cacheKey = taskConsoleCacheKey(session.id);

  const strategyMeta = useMemo(
    () => ({
      projectId: session.projectId,
      projectPath: session.projectPath,
      command: session.command,
      rebuildKey: session.rebuildKey,
    }),
    [
      session.projectId,
      session.projectPath,
      session.command,
      session.rebuildKey,
    ],
  );

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    let cancelled = false;

    const mount = async () => {
      // Drop finished PTY so rebuild re-runs the command
      const existing = terminalCache.get(cacheKey);
      if (existing && existing.sessionId === null && strategyMeta.rebuildKey > 0) {
        destroyTerminalCache(cacheKey);
      }

      const cached = terminalCache.get(cacheKey);
      if (cached) {
        if (!wrapper.contains(cached.element)) {
          wrapper.appendChild(cached.element);
        }
        requestAnimationFrame(() => {
          cached.fitAddon.fit();
          if (cached.sessionId) {
            void resizeTerminal(cached.sessionId, cached.term.cols, cached.term.rows);
          }
          if (active) cached.term.focus();
        });
        return;
      }

      try {
        await createTerminalForProject(
          cacheKey,
          strategyMeta.projectPath,
          session.name,
          null,
          config.terminalFontSize,
          wrapper,
          config.shell ?? "",
          config.fontFamily ?? "",
          strategyMeta.projectId,
          undefined,
          strategyMeta.command,
          // console session id — factory marks exit via markConsoleExit
          session.id,
          config.terminalGpuAcceleration ?? false,
        );
        if (cancelled) return;
      } catch (e) {
        console.error("[TaskConsole] failed to start terminal", e);
        useTaskStore.getState().markConsoleExit(session.id, 1);
      }
    };

    void mount();

    return () => {
      cancelled = true;
      const c = terminalCache.get(cacheKey);
      if (c?.element.parentElement === wrapper) {
        wrapper.removeChild(c.element);
      }
    };
  }, [cacheKey, strategyMeta, config, session.id, session.name, active]);

  useEffect(() => {
    if (!active) return;
    const c = terminalCache.get(cacheKey);
    if (!c) return;
    requestAnimationFrame(() => {
      c.fitAddon.fit();
      if (c.sessionId) {
        void resizeTerminal(c.sessionId, c.term.cols, c.term.rows);
      }
      c.term.focus();
    });
  }, [active, cacheKey]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (el) terminalWrapperRefs.set(cacheKey, el);
    return () => {
      terminalWrapperRefs.delete(cacheKey);
      terminalRebuildCallbacks.delete(cacheKey);
    };
  }, [cacheKey]);

  return (
    <div
      className="absolute inset-0 flex flex-col min-h-0 min-w-0"
      style={{ display: active ? "flex" : "none" }}
    >
      <div
        ref={wrapperRef}
        className="flex-1 min-h-0 min-w-0 overflow-hidden pl-2"
        style={{ backgroundColor: "var(--terminal-bg)" }}
      />
    </div>
  );
}

export default React.memo(TaskConsoleTerminal);

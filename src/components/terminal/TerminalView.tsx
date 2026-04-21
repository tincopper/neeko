import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { buildFontFamily } from "../../utils/terminal";
import type { AgentConfig } from "../../types";
import {
  terminalCache,
  terminalRebuildCallbacks,
  terminalWrapperRefs,
  executedAgentKeys,
  pendingPtyResize,
  setPendingPtyResize,
  terminalCacheKey,
  log,
} from "./terminalCache";
import { createTerminalForProject } from "./terminalFactory";
import type { TerminalCache, TerminalViewProps } from "./terminalTypes";

export {
  terminalCache,
  terminalRebuildCallbacks,
  terminalWrapperRefs,
  executedAgentKeys,
  pendingPtyResize,
  setPendingPtyResize,
  terminalCacheKey,
  destroyTerminalCache,
  destroyTerminalCachesByPrefix,
  refreshTerminal,
} from "./terminalCache";
export { createTerminalForProject } from "./terminalFactory";
export { launchAgentInTerminal, switchAgentInTerminal } from "./terminalCommands";

function TerminalView({
  project,
  paneId,
  tabId,
  tabAgentId,
  fontSize = 14,
  shell = "",
  fontFamily = "",
  suppressResizeRef,
  agentCommandOverride,
  onTabStatusChange,
}: TerminalViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentCacheKeyRef = useRef<string | null>(null);
  const [rebuildCount, setRebuildCount] = useState(0);

  const cacheKey = terminalCacheKey(project.id, tabId, paneId);

  useEffect(() => {
    const cache = terminalCache.get(cacheKey);
    if (cache) {
      cache.term.options.fontSize = fontSize;
      cache.term.options.fontFamily = buildFontFamily(fontFamily);
      cache.fitAddon.fit();
    }
  }, [fontSize, fontFamily, cacheKey]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    currentCacheKeyRef.current = cacheKey;

    terminalRebuildCallbacks.set(cacheKey, () => {
      if (currentCacheKeyRef.current === cacheKey) {
        log(`Rebuild triggered for ${cacheKey}`);
        setRebuildCount((c) => c + 1);
      }
    });

    terminalWrapperRefs.set(cacheKey, wrapper);

    const attach = (cache: TerminalCache) => {
      if (!wrapper.contains(cache.element)) {
        wrapper.appendChild(cache.element);
      }
      requestAnimationFrame(() => {
        if (currentCacheKeyRef.current !== cacheKey) {
          return;
        }
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
      while (wrapper.firstChild) {
        wrapper.removeChild(wrapper.firstChild);
      }
    };

    detachAll();

    if (terminalCache.has(cacheKey)) {
      log(`Reattaching existing terminal for ${project.name} (${cacheKey})`);
      attach(terminalCache.get(cacheKey)!);
    } else {
      createTerminalForProject(
        cacheKey,
        project.path,
        project.name,
        null,
        fontSize,
        wrapper,
        shell,
        fontFamily,
        project.id,
        undefined,
      ).then((cache) => {
        if (currentCacheKeyRef.current !== cacheKey) {
          return;
        }

        requestAnimationFrame(() => {
          if (currentCacheKeyRef.current !== cacheKey) {
            return;
          }
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

        if (tabAgentId && !executedAgentKeys.has(cacheKey) && cache.sessionId) {
          log(`Executing agent after terminal creation: ${tabAgentId}`);
          (async () => {
            try {
              const agent = await invoke<AgentConfig>("get_agent", {
                agentId: tabAgentId,
              });
              const cmd = agentCommandOverride ?? agent.command;
              const cmdStr =
                cmd +
                (agent.args.length ? ` ${agent.args.join(" ")}` : "") +
                "\r";

              const bytes = Array.from(new TextEncoder().encode(cmdStr));
              emit(`terminal-input-${cache.sessionId}`, bytes).catch((err) => {
                log(`Execute agent error: ${err}`);
              });

              executedAgentKeys.add(cacheKey);
              log(`Executed agent after creation: ${cmd}`);
              onTabStatusChange?.("Running");
            } catch (err) {
              log(`Failed to execute agent after creation: ${err}`);
            }
          })();
        }
      });
    }

    const handleResize = () => {
      if (suppressResizeRef?.current) {
        return;
      }
      const cache = terminalCache.get(cacheKey);
      if (!cache) {
        return;
      }
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

    let resizeRafId: number | null = null;
    const ro = new ResizeObserver(() => {
      if (resizeRafId !== null) {
        cancelAnimationFrame(resizeRafId);
      }
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = null;
        if (suppressResizeRef?.current) {
          return;
        }
        const c = terminalCache.get(cacheKey);
        if (!c) {
          return;
        }
        c.fitAddon.fit();
        if (pendingPtyResize && c.sessionId) {
          setPendingPtyResize(false);
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
      if (resizeRafId !== null) {
        cancelAnimationFrame(resizeRafId);
      }
      ro.disconnect();
      window.removeEventListener("resize", handleResize);
      detachAll();
      terminalRebuildCallbacks.delete(cacheKey);
      terminalWrapperRefs.delete(cacheKey);
    };
  }, [
    cacheKey,
    project.id,
    project.path,
    project.name,
    rebuildCount,
    fontSize,
    shell,
    fontFamily,
    agentCommandOverride,
    tabAgentId,
    onTabStatusChange,
  ]);

  useEffect(() => {
    if (!tabAgentId || executedAgentKeys.has(cacheKey)) {
      return;
    }

    const cache = terminalCache.get(cacheKey);
    if (!cache?.sessionId) {
      return;
    }

    const executeAgent = async () => {
      try {
        const agent = await invoke<AgentConfig>("get_agent", { agentId: tabAgentId });
        const cmd = agentCommandOverride ?? agent.command;
        const cmdStr =
          cmd + (agent.args.length ? ` ${agent.args.join(" ")}` : "") + "\r";

        const bytes = Array.from(new TextEncoder().encode(cmdStr));
        emit(`terminal-input-${cache.sessionId}`, bytes).catch((err) => {
          log(`Execute agent error: ${err}`);
        });

        executedAgentKeys.add(cacheKey);
        log(`Executed agent: ${cmd}`);
        onTabStatusChange?.("Running");
      } catch (err) {
        log(`Failed to execute agent: ${err}`);
      }
    };

    void executeAgent();
  }, [tabAgentId, cacheKey, agentCommandOverride]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      <div
        className="terminal-wrapper flex-1 p-0 bg-bg-primary overflow-hidden min-w-0 min-h-0"
        ref={wrapperRef}
      />
    </div>
  );
}

export default React.memo(
  TerminalView,
  (prev, next) =>
    prev.project.id === next.project.id &&
    prev.tabId === next.tabId &&
    prev.tabAgentId === next.tabAgentId &&
    prev.fontSize === next.fontSize &&
    prev.shell === next.shell &&
    prev.fontFamily === next.fontFamily &&
    prev.agentCommandOverride === next.agentCommandOverride &&
    prev.onTabStatusChange === next.onTabStatusChange,
);

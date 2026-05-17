import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useAppContext, useEditorContext } from "../../contexts";
import { buildFontFamily } from "../../utils/terminal";
import type { AgentConfig } from "../../types";
import { useAppStore } from "../../store/appStore";
import {
   terminalCache,
   destroyTerminalCache,
   terminalRebuildCallbacks,
   terminalWrapperRefs,
   executedAgentKeys,
   terminalCacheKey,
   log,
} from "./terminalCache";
import { createTerminalForProject } from "./terminalFactory";
import type { TerminalCache, TerminalViewProps } from "./terminalTypes";

function TerminalView({ paneId, worktreePath, worktreeBranch }: TerminalViewProps) {
   const { config } = useAppContext();
   const activeProject = useAppStore((state) => state.activeProject);
   const activeWorktreePath = useAppStore((state) => state.activeWorktreePath);
   const activeWorktreeBranch = useAppStore((state) => state.activeWorktreeBranch);
   const { tabs, activeTabId, onTabStatusChange } = useEditorContext();

   const wrapperRef = useRef<HTMLDivElement>(null);
   const currentCacheKeyRef = useRef<string | null>(null);
   const loadingElRef = useRef<HTMLDivElement | null>(null);
   const [rebuildCount, setRebuildCount] = useState(0);

   // Use prop if provided, otherwise read from store (worktree selected via sidebar)
   const effectiveWorktreePath = worktreePath ?? activeWorktreePath;
   const effectiveWorktreeBranch = worktreeBranch ?? activeWorktreeBranch;
   const isWorktree = !!effectiveWorktreePath;
   const projectId = activeProject?.id ?? null;
   const projectPath = effectiveWorktreePath ?? activeProject?.path ?? null;
   const baseName = activeProject?.name ?? null;
   const projectName = baseName && effectiveWorktreeBranch ? `${baseName} [${effectiveWorktreeBranch}]` : baseName;
   const projectSelectedAgent = activeProject?.selected_agent ?? null;
   const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
   const tabAgentId = activeTab?.agentId ?? null;
   const agentCommandOverride = config.agentCommandOverrides?.[
      tabAgentId ?? projectSelectedAgent ?? ""
   ];
   // Task terminal fields — read from the full Tab in appStore (TerminalTab is legacy, lacks .data)
   const fullTabData = useAppStore((s) => {
      if (!projectId || !activeTabId) return null;
      const pt = s.tabs[projectId];
      return pt?.tabs.find((t) => t.id === activeTabId)?.data ?? null;
   });
   const taskCommand = fullTabData?.kind === "terminal" ? (fullTabData.taskCommand ?? null) : null;
   const taskConfigId = fullTabData?.kind === "terminal" ? (fullTabData.taskConfigId ?? null) : null;
   // Incremented by taskStore.runTask() when reusing a finished task tab.
   // Including it in the main useEffect dep triggers a clean terminal rebuild.
   const taskRebuildKey = fullTabData?.kind === "terminal" ? (fullTabData.rebuildKey ?? 0) : 0;

   const handleTabStatusChange = useCallback(
      (status: "Idle" | "Running" | "Failed") => {
         if (activeTabId) {
            onTabStatusChange?.(activeTabId, status);
         }
      },
      [activeTabId, onTabStatusChange],
   );

   const cacheKey = projectId
      ? isWorktree
         ? `${projectId}:wt:${effectiveWorktreePath}:${activeTabId ?? "default"}:${paneId}`
         : terminalCacheKey(projectId, activeTabId, paneId)
      : `local:none:${paneId}`;

   useEffect(() => {
      if (!projectId) {
         return;
      }

      const cache = terminalCache.get(cacheKey);
      if (cache) {
         cache.term.options.fontSize = config.terminalFontSize;
         cache.term.options.fontFamily = buildFontFamily(config.fontFamily);
      }
   }, [projectId, cacheKey, config.terminalFontSize, config.fontFamily]);

   useEffect(() => {
      if (!projectId || !projectPath || !projectName) {
         return;
      }

      // Guard: if activeTabId is stale (from another project), skip PTY creation
      if (activeTabId && !isWorktree && tabs.length > 0 && !tabs.some((t) => t.id === activeTabId)) {
         return;
      }

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
               }).catch(() => { });
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

      // When a task tab is reused (rebuildKey bumped by taskStore), the old
      // terminal session has already been destroyed. If the cache still exists
      // but its sessionId is null it means the process exited and we're
      // rerunning — destroy it so we fall through to create a fresh terminal.
      const staleCache = terminalCache.get(cacheKey);
      if (staleCache && staleCache.sessionId === null && taskCommand) {
         log(`Stale task cache detected for ${cacheKey}, destroying for clean rebuild`);
         destroyTerminalCache(cacheKey);
      }

      const existingCache = terminalCache.get(cacheKey);
      if (existingCache) {
         log(`Reattaching existing terminal for ${projectName} (${cacheKey})`);
         attach(existingCache);
      } else {
         const loadingEl = document.createElement("div");
         loadingEl.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--terminal-foreground,#abb2bf);font-size:14px;opacity:0.6";
         loadingEl.textContent = "Connecting...";
         loadingElRef.current = loadingEl;
         wrapper.appendChild(loadingEl);
         createTerminalForProject(
            cacheKey,
            projectPath,
            projectName,
            null,
            config.terminalFontSize,
            wrapper,
            config.shell,
            config.fontFamily,
            projectId,
            undefined,
            taskCommand ?? undefined,
            taskConfigId ?? undefined,
            config.terminalGpuAcceleration,
         ).then((cache) => {
            if (loadingElRef.current) {
               loadingElRef.current.remove();
               loadingElRef.current = null;
            }
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
                  }).catch(() => { });
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
                     handleTabStatusChange("Running");
                  } catch (err) {
                     log(`Failed to execute agent after creation: ${err}`);
                  }
               })();
            }
         });
      }

      const handleResize = () => {
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
            }).catch(() => { });
         }
      };

      window.addEventListener("resize", handleResize);

      let roSkipFirst = true;
      let resizeRafId: number | null = null;
      const ro = new ResizeObserver(() => {
         if (roSkipFirst) {
            roSkipFirst = false;
            return;
         }
         if (resizeRafId !== null) {
            cancelAnimationFrame(resizeRafId);
         }
         resizeRafId = requestAnimationFrame(() => {
            resizeRafId = null;
            const c = terminalCache.get(cacheKey);
            if (!c) {
               return;
            }
             c.fitAddon.fit();
             if (c.sessionId) {
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
         if (loadingElRef.current) {
            loadingElRef.current.remove();
            loadingElRef.current = null;
         }
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
      projectId,
      projectPath,
      projectName,
      rebuildCount,
      taskCommand,
      taskRebuildKey,
      config.terminalFontSize,
      config.shell,
      config.fontFamily,
      agentCommandOverride,
      tabAgentId,
      handleTabStatusChange,
   ]);

   useEffect(() => {
      if (!projectId) {
         return;
      }

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
            handleTabStatusChange("Running");
         } catch (err) {
            log(`Failed to execute agent: ${err}`);
         }
      };

      void executeAgent();
   }, [projectId, tabAgentId, cacheKey, agentCommandOverride, handleTabStatusChange]);

   if (!projectId) {
      return null;
   }

   return (
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
         <div
            className="terminal-wrapper relative flex-1 p-0 pl-2 overflow-hidden min-w-0 min-h-0"
            style={{ backgroundColor: "var(--terminal-bg)" }}
            ref={wrapperRef}
         />
      </div>
   );
}

export default React.memo(TerminalView);

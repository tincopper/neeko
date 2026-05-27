import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import type { AgentConfig } from "../../types";
import { buildFontFamily, buildTerminalTheme } from "../../utils/terminal";
import { setupTerminalInput } from "./terminalInput";
import { tryLoadWebgl } from "./terminalFactory";
import type { TerminalStrategy, CacheEntry } from "./strategies/types";

interface TerminalViewBaseProps {
  strategy: TerminalStrategy;
  tabAgentId: string | null;
  activeTabId: string | null;
  taskCommand?: string | null;
  taskConfigId?: string | null;
  taskRebuildKey?: number;
  agentCommandOverride?: string;
  onStatusChange?: (status: "Idle" | "Running" | "Failed") => void;
}

export default React.memo(function TerminalViewBase({
  strategy,
  tabAgentId,
  activeTabId: _activeTabId,
  taskCommand,
  taskConfigId,
  taskRebuildKey = 0,
  agentCommandOverride,
  onStatusChange,
}: TerminalViewBaseProps) {
  const {
    cacheKey,
    cache,
    rebuildCallbacks,
    wrapperRefs,
    createSession,
    resizeCmd,
    agentDelayMs,
    connectingMessage,
    fontSize,
    fontFamily: fontFamilyProp,
    gpuAccel,
    onSessionReady,
    outputFilter,
    setupFileLinks,
  } = strategy;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentKeyRef = useRef<string | null>(null);
  const [rebuildCount, setRebuildCount] = useState(0);
  const [ready, setReady] = useState(false);

  // Sync font changes to existing instance
  useEffect(() => {
    const c = cache.get(cacheKey);
    if (!c) return;
    c.term.options.fontSize = fontSize;
    c.term.options.fontFamily = buildFontFamily(fontFamilyProp);
    c.fitAddon.fit();
  }, [fontSize, fontFamilyProp, cacheKey, cache]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    currentKeyRef.current = cacheKey;
    setReady(false);

    rebuildCallbacks.set(cacheKey, () => {
      if (currentKeyRef.current === cacheKey) setRebuildCount((c) => c + 1);
    });
    if (wrapperRef.current) {
      wrapperRefs.set(cacheKey, wrapperRef.current);
    }

    const attach = (entry: CacheEntry) => {
      if (!wrapper.contains(entry.element)) {
        wrapper.appendChild(entry.element);
      }
      requestAnimationFrame(() => {
        if (currentKeyRef.current !== cacheKey) return;
        entry.fitAddon.fit();
        if (entry.sessionId) {
          invoke(resizeCmd, {
            sessionId: entry.sessionId,
            cols: entry.term.cols,
            rows: entry.term.rows,
          }).catch(() => {});
        }
        entry.term.focus();
      });
    };

    const detachAll = () => {
      while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
    };

    detachAll();

    // Task rebuild guard: destroy stale task cache when rebuildKey bumps
    if (taskCommand && taskRebuildKey > 0) {
      const stale = cache.get(cacheKey);
      if (stale && stale.sessionId === null) {
        cache.delete(cacheKey);
      }
    }

    const existingCache = cache.get(cacheKey);
    if (existingCache) {
      setReady(!!existingCache.sessionId);
      attach(existingCache);
    } else {
      const element = document.createElement("div");
      element.style.width = "100%";
      element.style.height = "100%";

      const term = new Terminal({
        cursorBlink: true,
        fontSize,
        fontFamily: buildFontFamily(fontFamilyProp),
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
      if (gpuAccel) void tryLoadWebgl(term);
      if (setupFileLinks) setupFileLinks(term);
      fitAddon.fit();

      const entry = {
        term,
        fitAddon,
        element,
        sessionId: null as string | null,
        unlisten: null as (() => void) | null,
        inputController: null as ReturnType<typeof setupTerminalInput> | null,
      };
      cache.set(cacheKey, entry);

      term.write(connectingMessage);

      (async () => {
        try {
          const sessionId = await createSession(term.cols, term.rows, {
            command: taskCommand ?? undefined,
            configId: taskConfigId ?? undefined,
          });

          if (currentKeyRef.current !== cacheKey) return;
          entry.sessionId = sessionId;
          setReady(true);
          onSessionReady?.();

          if (tabAgentId) {
            const cmdOverride = agentCommandOverride;
            setTimeout(async () => {
              if (!entry.sessionId) return;
              try {
                const agent = await invoke<AgentConfig>("get_agent", { agentId: tabAgentId });
                const cmd = cmdOverride ?? agent.command;
                const cmdStr = [cmd, ...agent.args].join(" ") + "\r";
                const bytes = Array.from(new TextEncoder().encode(cmdStr));
                emit(`terminal-input-${entry.sessionId}`, bytes).catch(() => {});
                onStatusChange?.("Running");
              } catch (err) {
                console.error("[Terminal] Auto-launch agent failed:", err);
              }
            }, agentDelayMs);
          }

          const unlisten = await listen<number[]>(`terminal-output-${sessionId}`, (event) => {
            let bytes: Uint8Array = new Uint8Array(event.payload);
            if (outputFilter) bytes = outputFilter(bytes) as Uint8Array;
            term.write(bytes);
          });
          entry.unlisten = unlisten;

          entry.inputController = setupTerminalInput({
            term,
            sendInput: (text: string) => {
              if (!entry.sessionId) return;
              const bytes = Array.from(new TextEncoder().encode(text));
              emit(`terminal-input-${entry.sessionId}`, bytes).catch(() => {});
            },
          });

          requestAnimationFrame(() => {
            if (currentKeyRef.current !== cacheKey) return;
            fitAddon.fit();
            invoke(resizeCmd, {
              sessionId,
              cols: term.cols,
              rows: term.rows,
            }).catch(() => {});
            term.focus();
          });
        } catch (err) {
          if (currentKeyRef.current !== cacheKey) return;
          setReady(true);
          term.write(`\x1b[31mFailed to connect: ${err}\x1b[0m\r\n`);
        }
      })();
    }

    let resizeRafId: number | null = null;
    let prevCols = 0;
    let prevRows = 0;
    const ro = new ResizeObserver(() => {
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = null;
        const c = cache.get(cacheKey);
        if (!c) return;
        c.fitAddon.fit();
        if (c.sessionId && (c.term.cols !== prevCols || c.term.rows !== prevRows)) {
          prevCols = c.term.cols;
          prevRows = c.term.rows;
          invoke(resizeCmd, {
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
      detachAll();
      rebuildCallbacks.delete(cacheKey);
      wrapperRefs.delete(cacheKey);
    };
  }, [cacheKey, rebuildCount, taskRebuildKey]);

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
      {!ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-text-secondary text-[var(--terminal-font-size)]">
          Connecting...
        </div>
      )}
      <div
        className="terminal-wrapper flex-1 p-0 pl-2 overflow-hidden min-w-0 min-h-0"
        style={{ backgroundColor: "var(--terminal-bg)" }}
        ref={wrapperRef}
      />
    </div>
  );
});

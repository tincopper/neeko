/**
 * Bottom Console panel for task run output (not editor tabs).
 * Layout chrome aligned with DebugPanel.
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Square, Terminal, X } from "@/shared/components/icons";
import { cn } from "@/shared/utils/cn";
import { buildFontFamily } from "@/shared/utils/terminal";
import { useAppContext } from "@/shared/contexts/AppContext";

import { useTaskStore } from "../store";
import TaskConsoleTerminal from "./TaskConsoleTerminal";

const PANEL_H_KEY = "neeko.task.consoleHeight";
const PANEL_H_DEFAULT = 260;
const PANEL_H_MIN = 120;
const PANEL_H_MAX_RATIO = 0.7;

function readStored(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

function TaskConsolePanel() {
  const panelOpen = useTaskStore((s) => s.consolePanelOpen);
  const sessions = useTaskStore((s) => s.consoleSessions);
  const activeConsoleId = useTaskStore((s) => s.activeConsoleId);
  const setConsolePanelOpen = useTaskStore((s) => s.setConsolePanelOpen);
  const setActiveConsoleId = useTaskStore((s) => s.setActiveConsoleId);
  const closeConsoleSession = useTaskStore((s) => s.closeConsoleSession);
  const stopTask = useTaskStore((s) => s.stopTask);
  const { config } = useAppContext();
  const terminalType = useMemo(
    () => ({
      fontSize: config.terminalFontSize ?? 14,
      fontFamily: buildFontFamily(config.fontFamily ?? ""),
    }),
    [config.terminalFontSize, config.fontFamily],
  );

  const latestH = useRef(PANEL_H_DEFAULT);
  const [panelHeight, setPanelHeight] = useState(() =>
    readStored(PANEL_H_KEY, PANEL_H_DEFAULT),
  );

  const startPanelResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = panelHeight;
      const onMove = (ev: MouseEvent) => {
        const delta = startY - ev.clientY;
        const maxH = Math.floor(window.innerHeight * PANEL_H_MAX_RATIO);
        const next = Math.min(maxH, Math.max(PANEL_H_MIN, startH + delta));
        latestH.current = next;
        setPanelHeight(next);
      };
      const onUp = () => {
        writeStored(PANEL_H_KEY, latestH.current);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [panelHeight],
  );

  if (!panelOpen) return null;

  const active = sessions.find((s) => s.id === activeConsoleId) ?? sessions[0] ?? null;

  return (
    <div className="shrink-0 mx-11 px-px pb-0.5">
      <div
        className="relative flex flex-col overflow-hidden rounded-lg shadow-sm bg-bg-secondary"
        style={{ height: panelHeight }}
      >
        <div
          className="absolute top-0 left-0 right-0 h-3 z-20 cursor-row-resize group"
          onMouseDown={startPanelResize}
          title="Drag to resize console"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize console panel"
        >
          <div className="absolute left-0 right-0 top-0 h-1 bg-transparent group-hover:bg-accent-blue/50 group-active:bg-accent-blue/60 transition-colors rounded-t-lg" />
          <div className="absolute left-1/2 top-1 -translate-x-1/2 w-8 h-[3px] rounded-full bg-border/80 group-hover:bg-accent-blue/70 group-active:bg-accent-blue transition-colors" />
        </div>

        {/* Header + session tabs */}
        <div className="flex items-center border-b border-border shrink-0 bg-bg-secondary h-8 rounded-t-lg gap-1 pr-1">
          <div className="inline-flex items-center gap-1.5 shrink-0 px-2.5">
            <Terminal size={13} className="text-text-secondary shrink-0" />
            <span className="text-[var(--font-size)] font-medium text-text-primary">
              Console
            </span>
          </div>

          <div className="w-px h-3.5 bg-border shrink-0" />

          <div className="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto h-full">
            {sessions.length === 0 ? (
              <span className="px-2 text-[calc(var(--font-size)-1px)] text-text-muted">
                No task runs yet
              </span>
            ) : (
              sessions.map((s) => {
                const isActive = s.id === (active?.id ?? activeConsoleId);
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "group flex items-center gap-1.5 h-full px-2 max-w-[160px] cursor-pointer border-b-2 shrink-0",
                      isActive
                        ? "border-accent-blue text-text-primary bg-bg-hover/40"
                        : "border-transparent text-text-secondary hover:text-text-primary hover:bg-bg-hover/30",
                    )}
                    onClick={() => setActiveConsoleId(s.id)}
                    title={`${s.name}\n${s.command}`}
                  >
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        s.status === "running"
                          ? "bg-accent-green animate-pulse"
                          : s.status === "failed"
                            ? "bg-accent-red"
                            : "bg-text-muted",
                      )}
                    />
                    <span className="truncate text-[calc(var(--font-size)-1px)]">
                      {s.name}
                    </span>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-text-muted hover:text-text-primary"
                      title="Close console tab"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeConsoleSession(s.id);
                      }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {active?.status === "running" ? (
            <button
              type="button"
              className="shrink-0 flex items-center gap-1 px-2 h-6 rounded text-[calc(var(--font-size)-1px)] text-accent-red hover:bg-bg-hover cursor-pointer"
              title="Stop task"
              onClick={() => stopTask(active.id)}
            >
              <Square size={11} fill="currentColor" strokeWidth={0} />
              Stop
            </button>
          ) : null}

          <button
            type="button"
            className="shrink-0 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer"
            title="Hide console"
            onClick={() => setConsolePanelOpen(false)}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body: keep all session terminals mounted for output retention */}
        <div
          className="flex-1 flex flex-col min-h-0"
          style={{ backgroundColor: "var(--terminal-bg, var(--bg-secondary))" }}
        >
          <div className="relative flex-1 min-h-0">
            {sessions.length === 0 ? (
              <div
                className="flex h-full items-center justify-center px-3 text-center leading-relaxed"
                style={{
                  fontSize: `${terminalType.fontSize}px`,
                  fontFamily: terminalType.fontFamily,
                  color: "var(--terminal-fg-dim, var(--text-muted))",
                }}
              >
                Run a task from the Run menu to stream output here.
              </div>
            ) : (
              sessions.map((s) => (
                <TaskConsoleTerminal
                  key={`${s.id}:${s.rebuildKey}`}
                  session={s}
                  active={s.id === (active?.id ?? "")}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default React.memo(TaskConsolePanel);

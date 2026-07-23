/**
 * Read-only output view for one TaskRun.
 *
 * Renders the run's accumulated `output` buffer into an xterm instance used only
 * as a terminal emulator (ANSI, scrollback) — never as a PTY host.
 * Mount/unmount does not start or stop the task process.
 */
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import React, { useEffect, useRef } from "react";

import { useAppContext } from "@/shared/contexts/AppContext";
import {
  buildFontFamily,
  buildTerminalTheme,
} from "@/shared/utils/terminal";

import type { TaskRun } from "../types";

import "@xterm/xterm/css/xterm.css";

interface Props {
  run: TaskRun;
  active: boolean;
}

function TaskConsoleOutput({ run, active }: Props) {
  const { config } = useAppContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  /** How much of `run.output` has already been written to the terminal. */
  const writtenLenRef = useRef(0);

  // Create / dispose terminal once per run id
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      cursorStyle: "underline",
      fontSize: config.terminalFontSize ?? 14,
      fontFamily: buildFontFamily(config.fontFamily ?? ""),
      theme: buildTerminalTheme(),
      scrollback: 10000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;
    writtenLenRef.current = 0;

    // Initial buffer (may already have content if panel reopened mid-run)
    if (run.output) {
      term.write(run.output);
      writtenLenRef.current = run.output.length;
      term.scrollToBottom();
    }

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      writtenLenRef.current = 0;
    };
    // Only recreate when run identity changes — not when output grows
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: buffer streamed via second effect
  }, [run.id, config.terminalFontSize, config.fontFamily]);

  // Stream new output chunks without rewriting the whole buffer
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const full = run.output;
    const prev = writtenLenRef.current;
    if (full.length < prev) {
      // Buffer was reset (re-run) — clear and rewrite
      term.reset();
      term.write(full);
      writtenLenRef.current = full.length;
      term.scrollToBottom();
      return;
    }
    if (full.length > prev) {
      term.write(full.slice(prev));
      writtenLenRef.current = full.length;
      term.scrollToBottom();
    }
  }, [run.output]);

  // Fit + show when becoming active
  useEffect(() => {
    if (!active) return;
    const fit = fitRef.current;
    requestAnimationFrame(() => {
      try {
        fit?.fit();
      } catch {
        /* ignore */
      }
      termRef.current?.scrollToBottom();
    });
  }, [active, run.id]);

  return (
    <div
      className="absolute inset-0 flex flex-col min-h-0 min-w-0"
      style={{ display: active ? "flex" : "none" }}
      data-testid={`task-console-output-${run.id}`}
      data-run-status={run.status}
    >
      <div
        ref={containerRef}
        className="flex-1 min-h-0 min-w-0 overflow-hidden pl-2"
        style={{ backgroundColor: "var(--terminal-bg, var(--bg-secondary))" }}
      />
    </div>
  );
}

export default React.memo(TaskConsoleOutput);

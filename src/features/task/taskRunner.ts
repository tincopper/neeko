/**
 * Task process runner — owns process lifecycle and output collection.
 *
 * High cohesion: start / stop / stream only.
 * Low coupling: no React, no Console panel, no xterm, no terminal feature imports.
 * Extensible: swap backends via taskApi without touching the UI.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import {
  startTaskProcessSession,
  stopTaskProcessSession,
} from "./api/taskApi";

export interface TaskProcessHandle {
  processId: string;
  /** Detach output listeners (does not kill the process). */
  dispose: () => void;
}

export interface StartTaskProcessOptions {
  command: string;
  cwd: string;
  projectId: string;
  cols?: number;
  rows?: number;
  onOutput: (chunk: string) => void;
  onExit: (exitCode: number) => void;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;

/**
 * Start a task as a dedicated process (`sh -c` / `cmd /c` via terminal manager).
 * Streams `terminal-output-{id}` into `onOutput` and reports exit via `onExit`.
 */
export async function startTaskProcess(
  opts: StartTaskProcessOptions,
): Promise<TaskProcessHandle> {
  const cols = opts.cols ?? DEFAULT_COLS;
  const rows = opts.rows ?? DEFAULT_ROWS;

  const session = await startTaskProcessSession(
    opts.projectId,
    cols,
    rows,
    opts.cwd || null,
    opts.command,
  );
  const processId = session.id;

  const decoder = new TextDecoder("utf-8", { fatal: false });
  let disposed = false;
  let unlistenOutput: UnlistenFn | null = null;
  let unlistenClosed: UnlistenFn | null = null;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unlistenOutput?.();
    unlistenClosed?.();
    unlistenOutput = null;
    unlistenClosed = null;
  };

  try {
    unlistenOutput = await listen<number[]>(`terminal-output-${processId}`, (event) => {
      if (disposed) return;
      const bytes = new Uint8Array(event.payload);
      // Drop DEL noise (same filter as interactive terminals)
      const filtered = bytes.filter((b) => b !== 0x7f);
      if (filtered.length === 0) return;
      opts.onOutput(decoder.decode(filtered, { stream: true }));
    });

    unlistenClosed = await listen<{ exit_code: number }>(
      `terminal-closed-${processId}`,
      (event) => {
        if (disposed) return;
        const code = event.payload?.exit_code ?? -1;
        // Flush decoder
        const tail = decoder.decode();
        if (tail) opts.onOutput(tail);
        dispose();
        opts.onExit(code);
      },
    );
  } catch (e) {
    dispose();
    try {
      await stopTaskProcessSession(processId);
    } catch {
      /* ignore */
    }
    throw e;
  }

  return {
    processId,
    dispose,
  };
}

/** Stop a running task process. Safe if already exited. */
export async function stopTaskProcess(processId: string): Promise<void> {
  await stopTaskProcessSession(processId);
}

/** Format a banner written into the output buffer (not a shell). */
export function formatTaskHeader(command: string, cwd: string): string {
  const lines = [
    `\x1b[90m────────────────────────────────────────\x1b[0m`,
    `\x1b[36m> ${command}\x1b[0m`,
    cwd ? `\x1b[90m  cwd: ${cwd}\x1b[0m` : "",
    `\x1b[90m────────────────────────────────────────\x1b[0m`,
    "",
  ].filter(Boolean);
  return `${lines.join("\r\n")}\r\n`;
}

export function formatTaskExit(exitCode: number): string {
  if (exitCode === 0) {
    return `\r\n\x1b[90m[Process exited with code 0]\x1b[0m\r\n`;
  }
  return `\r\n\x1b[31m[Process exited with code ${exitCode}]\x1b[0m\r\n`;
}

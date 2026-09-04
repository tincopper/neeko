/**
 * Task process runner — owns process lifecycle and output collection.
 *
 * High cohesion: start / stop / stream / write input only.
 * Low coupling: no React, no Console panel, no xterm, no terminal feature imports.
 * Extensible: swap backends via taskApi without touching the UI.
 */
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';

import {
  createDrainTransportScheduler,
  type DrainTransportScheduler,
} from '@/shared/utils/drainLoop';
import { reportFrontendError } from '@/shared/utils/errorReporting';
import { terminalClosedEvent, terminalInputEvent } from '@/shared/utils/terminalEvents';

import {
  drainTaskProcessOutput,
  drainTaskProcessOutputWait,
  startTaskProcessSession,
  stopTaskProcessSession,
} from './api/taskApi';

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
export async function startTaskProcess(opts: StartTaskProcessOptions): Promise<TaskProcessHandle> {
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

  const decoder = new TextDecoder('utf-8', { fatal: false });
  let disposed = false;
  let unlistenClosed: UnlistenFn | null = null;
  // scheduler 需在 dispose 中注销传输，故提升到外层作用域。
  let scheduler: DrainTransportScheduler | null = null;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unlistenClosed?.();
    scheduler?.dispose();
    unlistenClosed = null;
    scheduler = null;
  };

  try {
    // credit-pull 输出协议（内存治理）：后端输出汇入有界 SessionDrain，前端
    // 经调度器拉取二进制块并解码为文本。无 xterm 门闸（pendingWrites 恒 0），
    // 循环拉到空为止；下游 onOutput 由 taskStore 的输出截断兜底
    // （MAX_TASK_OUTPUT_CHARS）。
    // 方案 B（去 eval 化）：触发源由 terminal-drain-{id} 事件改为 fetch 拉取
    // ——macOS 上事件送达 = 每次 evaluateJavaScript（WebKit 无条件克隆+
    // stringify 完成值 → WebContent RSS 只增不减）；invoke 走 custom
    // protocol fetch，零 eval 零克隆。默认 long-poll 挂起式 drain
    // （createDrainTransportScheduler），VITE_TERMINAL_DRAIN_POLL=1 时回退轮询。
    scheduler = createDrainTransportScheduler({
      sessionId: processId,
      drain: drainTaskProcessOutput,
      drainWait: drainTaskProcessOutputWait,
      write: (chunk) => {
        const filtered = new Uint8Array(chunk).filter((b) => b !== 0x7f);
        if (filtered.length === 0) return;
        opts.onOutput(decoder.decode(filtered, { stream: true }));
      },
      pendingWrites: () => 0,
    });

    unlistenClosed = await listen<{ exit_code: number }>(
      terminalClosedEvent(processId),
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

/** Send keyboard input to a live task PTY session. */
export function writeTaskInput(processId: string, text: string): void {
  const bytes = Array.from(new TextEncoder().encode(text));
  void emit(terminalInputEvent(processId), bytes).catch((error) => {
    reportFrontendError('task.writeTaskInput', error);
  });
}

/** Format a banner written into the output buffer (not a shell). */
export function formatTaskHeader(command: string, cwd: string): string {
  const lines = [
    `\x1b[90m────────────────────────────────────────\x1b[0m`,
    `\x1b[36m> ${command}\x1b[0m`,
    cwd ? `\x1b[90m  cwd: ${cwd}\x1b[0m` : '',
    `\x1b[90m────────────────────────────────────────\x1b[0m`,
    '',
  ].filter(Boolean);
  return `${lines.join('\r\n')}\r\n`;
}

export function formatTaskExit(exitCode: number): string {
  if (exitCode === 0) {
    return `\r\n\x1b[90m[Process exited with code 0]\x1b[0m\r\n`;
  }
  return `\r\n\x1b[31m[Process exited with code ${exitCode}]\x1b[0m\r\n`;
}

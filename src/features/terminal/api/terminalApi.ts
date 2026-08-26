import { invoke } from '@tauri-apps/api/core';

/** Mirrors the Rust crate::terminal::types::TerminalSession struct */
export interface TerminalSession {
  id: string;
  pid: number | null;
  status: 'Idle' | 'Running' | 'Failed';
  history: string[];
  agent: {
    id: string;
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    icon: string | null;
    enabled: boolean;
    skill_path?: string | null;
    prompt_args?: string[] | null;
    post_prompt_args?: string[] | null;
    is_builtin?: boolean;
  } | null;
}

export function createTerminalSession(
  projectId: string,
  cols: number,
  rows: number,
  shell?: string | null,
  workingDir?: string | null,
  command?: string | null,
): Promise<TerminalSession> {
  return invoke<TerminalSession>('create_terminal_session', {
    projectId,
    cols,
    rows,
    shell,
    workingDir,
    command,
  });
}

export function closeTerminalSession(sessionId: string): Promise<void> {
  return invoke<void>('close_terminal_session', { sessionId });
}

export function resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke<void>('resize_terminal', { sessionId, cols, rows });
}

/**
 * Pulls all buffered terminal output for a session as raw bytes (credit-pull
 * protocol). Backend returns a binary `tauri::ipc::Response` — zero JSON
 * serialization overhead; empty ArrayBuffer means "queue drained".
 */
export function drainTerminal(sessionId: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('terminal_drain', { sessionId });
}

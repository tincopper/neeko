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
    skillPath?: string | null;
    prompt_args?: string[] | null;
    post_prompt_args?: string[] | null;
    is_builtin?: boolean;
    default_skill_path?: string | null;
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

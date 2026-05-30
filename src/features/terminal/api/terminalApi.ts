import { invoke } from '@tauri-apps/api/core';

import type { AuthMethod } from '@/features/connection/types';

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

// ─── Local terminal ──────────────────────────────────────────────────────────

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

// ─── WSL terminal ────────────────────────────────────────────────────────────

export function createWslTerminalSession(
  distro: string,
  projectPath: string,
  cols: number,
  rows: number,
): Promise<TerminalSession> {
  return invoke<TerminalSession>('create_wsl_terminal_session', {
    distro,
    projectPath,
    cols,
    rows,
  });
}

// ─── Remote terminal ─────────────────────────────────────────────────────────

export function createRemoteTerminalSession(
  host: string,
  port: number,
  username: string,
  auth: AuthMethod,
  projectPath: string,
  cols: number,
  rows: number,
): Promise<TerminalSession> {
  return invoke<TerminalSession>('create_remote_terminal_session', {
    host,
    port,
    username,
    auth,
    projectPath,
    cols,
    rows,
  });
}

export function closeRemoteTerminalSession(sessionId: string): Promise<void> {
  return invoke<void>('close_remote_terminal_session', { sessionId });
}

export function resizeRemoteTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke<void>('resize_remote_terminal', { sessionId, cols, rows });
}

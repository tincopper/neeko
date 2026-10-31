import { invoke } from '@tauri-apps/api/core';

import type { WorkspaceSession } from '@/shared/utils/workspaceRef';

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

/**
 * `create_terminal_session` 的可选载荷。
 *
 * 收成对象而不是位置参数：四个可选字段里 WSL / SSH 只用 `agentId`，位置参数会退化成
 * `(session, cols, rows, null, null, null, agentId)` —— 加字段就错位，且读不出意图。
 */
export interface CreateTerminalOptions {
  /** shell 覆盖（仅本地；WSL / SSH 由远端决定）。 */
  shell?: string | null;
  /** Workspace 内子目录覆盖（交互终端不传）。 */
  workingDir?: string | null;
  /** 任务命令（有值 = 任务终端，主题准备据此跳过）。 */
  command?: string | null;
  /**
   * 这条终端跑哪个 agent（`null` = 纯 shell）。
   *
   * **显式字段**，不从 `command` 字符串反推：反推会覆盖它本不覆盖的情况
   * （`ChatLaunch::inprocess` 的教训）。live-sessions 的会话行图标与占位标题取自它。
   */
  agentId?: string | null;
}

/**
 * Create a terminal session addressed by Workspace.
 *
 * 运行根（cwd）由后端从 `workspace` 派生：缺省 = 工作树根 / 项目根；`workingDir`
 * 为可选的 Workspace 内子目录覆盖（交互终端不传）。
 */
export function createTerminalSession(
  workspace: WorkspaceSession,
  cols: number,
  rows: number,
  options: CreateTerminalOptions = {},
): Promise<TerminalSession> {
  return invoke<TerminalSession>('create_terminal_session', {
    workspace,
    cols,
    rows,
    shell: options.shell ?? null,
    workingDir: options.workingDir ?? null,
    command: options.command ?? null,
    agentId: options.agentId ?? null,
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

/**
 * Long-poll drain: 无数据时后端挂起至数据到达/超时（而非立即返回空）。
 * 会话已关闭/不存在时后端返回 NotFound（reject）。二进制响应，零 JSON。
 */
export function drainTerminalWait(sessionId: string, timeoutMs: number): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('terminal_drain_wait', { sessionId, timeoutMs });
}

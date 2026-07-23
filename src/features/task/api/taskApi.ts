import { invoke } from '@tauri-apps/api/core';

import type { TaskConfig } from '@/shared/types';
import type { DiscoveredTask } from '../types';

export function getTaskConfigs(projectPath?: string | null): Promise<TaskConfig[]> {
  return invoke<TaskConfig[]>('get_task_configs', { projectPath });
}

export function discoverTaskConfigs(projectPath: string): Promise<DiscoveredTask[]> {
  return invoke<DiscoveredTask[]>('discover_task_configs', { projectPath });
}

export function importDiscoveredTask(
  task: DiscoveredTask,
  projectPath: string,
  projectId?: string | null,
): Promise<TaskConfig> {
  return invoke<TaskConfig>('import_discovered_task', {
    task,
    projectPath,
    projectId: projectId ?? null,
  });
}

export function saveTaskConfig(config: TaskConfig, projectPath?: string | null): Promise<void> {
  return invoke<void>('save_task_config', { config, projectPath });
}

export function deleteTaskConfig(
  id: string,
  scope: string,
  projectPath?: string | null,
): Promise<void> {
  return invoke<void>('delete_task_config', { id, scope, projectPath });
}

/**
 * @deprecated Prefer {@link startTaskProcessSession} — spawns a shell then injects
 * the command as input; the dedicated process session path is more reliable.
 */
export function runTask(command: string, cwd: string): Promise<string> {
  return invoke<string>('run_task', { command, cwd });
}

/** Stop a process session started for a task (shared terminal manager close). */
export function stopTask(sessionId: string): Promise<void> {
  return invoke<void>('stop_task', { sessionId });
}

/** Mirrors terminal session DTO — kept local so task does not import terminal feature. */
export interface TaskProcessSession {
  id: string;
  pid: number | null;
  status: string;
}

/**
 * Start a dedicated process for a task command (`sh -c` / `cmd /c` via terminal manager).
 * Output is streamed on `terminal-output-{id}`; exit on `terminal-closed-{id}`.
 */
export function startTaskProcessSession(
  projectId: string,
  cols: number,
  rows: number,
  workingDir: string | null,
  command: string,
): Promise<TaskProcessSession> {
  return invoke<TaskProcessSession>('create_terminal_session', {
    projectId,
    cols,
    rows,
    shell: null,
    workingDir,
    command,
  });
}

export function stopTaskProcessSession(sessionId: string): Promise<void> {
  // Same manager as interactive terminals; stop_task closes the session.
  return invoke<void>('stop_task', { sessionId });
}

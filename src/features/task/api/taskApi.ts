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

export function runTask(command: string, cwd: string): Promise<string> {
  return invoke<string>('run_task', { command, cwd });
}

export function stopTask(sessionId: string): Promise<void> {
  return invoke<void>('stop_task', { sessionId });
}

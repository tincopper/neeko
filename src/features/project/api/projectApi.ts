import { invoke } from '@tauri-apps/api/core';

import type { GitInfo } from '@/features/git/types';

import type { Project } from '../types';

export function addProject(
  path: string,
  agentId?: string | null,
  ide?: string | null,
  avatarColor?: string | null,
): Promise<Project> {
  return invoke<Project>('add_project', { path, agentId, ide, avatarColor });
}

export function removeProject(projectId: string): Promise<void> {
  return invoke<void>('remove_project', { projectId });
}

export function listProjects(): Promise<Project[]> {
  return invoke<Project[]>('list_projects');
}

export function getProject(projectId: string): Promise<Project> {
  return invoke<Project>('get_project', { projectId });
}

export function refreshGitInfo(projectId: string): Promise<GitInfo> {
  return invoke<GitInfo>('refresh_git_info', { projectId });
}

export function setActiveProject(projectId: string): Promise<void> {
  return invoke<void>('set_active_project', { projectId });
}

export function getActiveProject(): Promise<string | null> {
  return invoke<string | null>('get_active_project');
}

export function setViewTerminal(projectId: string): Promise<void> {
  return invoke<void>('set_view_terminal', { projectId });
}

export function setViewDiff(projectId: string, filePath: string): Promise<void> {
  return invoke<void>('set_view_diff', { projectId, filePath });
}

export function setProjectCollapsed(projectId: string, collapsed: boolean): Promise<void> {
  return invoke<void>('set_project_collapsed', { projectId, collapsed });
}

export function setProjectColor(projectId: string, color?: string | null): Promise<void> {
  return invoke<void>('set_project_color', { projectId, color });
}

export function renameProject(projectId: string, newName: string): Promise<void> {
  return invoke<void>('rename_project', { projectId, newName });
}

export function changeProjectPath(projectId: string, newPath: string): Promise<void> {
  return invoke<void>('change_project_path', { projectId, newPath });
}

export function reorderProjects(orderedIds: string[]): Promise<void> {
  return invoke<void>('reorder_projects', { orderedIds });
}

// ─── IDE commands ────────────────────────────────────────────────────────────

export function setProjectIde(projectId: string, ide?: string | null): Promise<void> {
  return invoke<void>('set_project_ide', { projectId, ide });
}

export function openIde(
  ideCommand: string,
  projectPath: string,
  macAppName?: string | null,
): Promise<void> {
  return invoke<void>('open_ide', { ideCommand, projectPath, macAppName });
}

export function openRemoteIde(
  host: string,
  port: number,
  username: string,
  projectPath: string,
  ide: string,
): Promise<void> {
  return invoke<void>('open_remote_ide', { host, port, username, projectPath, ide });
}

export function openWslIde(distro: string, projectPath: string, ide: string): Promise<void> {
  return invoke<void>('open_wsl_ide', { distro, projectPath, ide });
}

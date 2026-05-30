import { invoke } from '@tauri-apps/api/core';

import type { WSLEntrySession, RemoteEntrySession } from '@/features/connection/types';

import type { SessionStore } from '../types';

export function saveConfig(config: Record<string, unknown>): Promise<void> {
  return invoke<void>('save_config', { config });
}

export function loadConfig(): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>('load_config');
}

export function saveSession(
  wslEntries: WSLEntrySession[],
  remoteEntries: RemoteEntrySession[],
  sidebarWidth?: number | null,
  worktreeState?: Record<string, string> | null,
): Promise<void> {
  return invoke<void>('save_session', { wslEntries, remoteEntries, sidebarWidth, worktreeState });
}

export function loadSession(): Promise<SessionStore> {
  return invoke<SessionStore>('load_session');
}

export function getConfigDir(): Promise<string> {
  return invoke<string>('get_config_dir');
}

export function greet(name: string): Promise<string> {
  return invoke<string>('greet', { name });
}

export function saveVcsSettings(
  projectId: string,
  settings: Record<string, unknown>,
): Promise<void> {
  return invoke<void>('save_vcs_settings_command', { projectId, settings });
}

export function loadVcsSettings(projectId: string): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>('load_vcs_settings_command', { projectId });
}

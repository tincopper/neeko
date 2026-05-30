import { invoke } from '@tauri-apps/api/core';

export function getSystemFonts(): Promise<string[]> {
  return invoke<string[]>('get_system_fonts');
}

export function saveConfig(config: Record<string, unknown>): Promise<void> {
  return invoke<void>('save_config', { config });
}

export function loadConfig(): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>('load_config');
}

export interface WslProjectThemeTarget {
  distro: string;
  path: string;
}

export interface ProjectThemeTargets {
  local_paths: string[];
  wsl: WslProjectThemeTarget[];
}

export function syncAgentTheme(theme: string, targets: ProjectThemeTargets): Promise<void> {
  return invoke<void>('sync_agent_theme', { theme, targets });
}

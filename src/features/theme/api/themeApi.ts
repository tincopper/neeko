import { invoke } from '@tauri-apps/api/core';

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

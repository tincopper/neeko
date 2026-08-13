import { invoke } from '@tauri-apps/api/core';

import type { ThemeListItem, CustomThemeData } from '@/features/settings/types';
import type { AppInfo } from '@/shared/types/app';

export function getSystemFonts(): Promise<string[]> {
  return invoke<string[]>('get_system_fonts');
}

/** 查询应用版本与元数据信息（设置面板 About 页数据源）。 */
export function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>('get_app_info');
}

/** 用户确认退出应用：销毁主窗口（关闭确认流程的最终动作）。 */
export function confirmAppExit(): Promise<void> {
  return invoke<void>('confirm_app_exit');
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

export function listCustomThemes(): Promise<ThemeListItem[]> {
  return invoke<ThemeListItem[]>('list_custom_themes');
}

export function getCustomTheme(themeName: string): Promise<CustomThemeData | null> {
  return invoke<CustomThemeData | null>('get_custom_theme', { themeName });
}

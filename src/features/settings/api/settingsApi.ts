import { invoke } from '@tauri-apps/api/core';

import type { ThemeListItem, CustomThemeData } from '@/features/settings/types';
import type { JavaDebugBackend } from '@/shared/types';
import type { AppInfo } from '@/shared/types/app';
import { parseJavaDebugBackend } from '@/shared/utils/javaDebugBackend';

export function getSystemFonts(): Promise<string[]> {
  return invoke<string[]>('get_system_fonts');
}

/** 使后端进程级字体缓存失效，下次 getSystemFonts 会重新枚举（安装新字体后调用）。 */
export function resetSystemFonts(): Promise<void> {
  return invoke<void>('reset_font_cache');
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

/**
 * 读取 `dap.javaBackend`（缺键 / 非法 / 读取失败一律 `auto`）。
 *
 * **唯一的解析点**：前端各处（门控跳过、后端 dispatch）都走这里，避免同一份
 * "合法值 + 兜底" 规则抄成多份。注意后端在同一次调用内仍会**权威复核**该键。
 */
export async function loadJavaDebugBackend(): Promise<JavaDebugBackend> {
  try {
    const raw = await loadConfig();
    const value = (raw.dap as { javaBackend?: unknown } | undefined)?.javaBackend;
    return parseJavaDebugBackend(value);
  } catch {
    return 'auto';
  }
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

import { invoke } from '@tauri-apps/api/core';

import { getProjectBrowserLabel } from '../hooks/useBrowserConstants';

export function createBrowserWebview(
  projectId: string,
  url: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<string> {
  const label = getProjectBrowserLabel(projectId);
  return invoke<string>('create_browser_webview', { label, url, x, y, width, height });
}

export function browserNavigate(projectId: string, url: string): Promise<void> {
  const label = getProjectBrowserLabel(projectId);
  return invoke<void>('browser_navigate', { label, url });
}

export function browserSetBounds(
  projectId: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  const label = getProjectBrowserLabel(projectId);
  return invoke<void>('browser_set_bounds', { label, x, y, width, height });
}

export function browserOpenDevtools(projectId: string): Promise<void> {
  const label = getProjectBrowserLabel(projectId);
  return invoke<void>('browser_open_devtools', { label });
}

export function browserClose(projectId: string): Promise<void> {
  const label = getProjectBrowserLabel(projectId);
  return invoke<void>('browser_close', { label });
}

export function browserSetVisible(projectId: string, visible: boolean): Promise<void> {
  const label = getProjectBrowserLabel(projectId);
  return invoke<void>('browser_set_visible', { label, visible });
}

export function browserGoBack(projectId: string): Promise<void> {
  const label = getProjectBrowserLabel(projectId);
  return invoke<void>('browser_go_back', { label });
}

export function browserGoForward(projectId: string): Promise<void> {
  const label = getProjectBrowserLabel(projectId);
  return invoke<void>('browser_go_forward', { label });
}

export function browserStartPicker(
  projectId: string,
  themeColors?: Record<string, string>,
): Promise<void> {
  const label = getProjectBrowserLabel(projectId);
  return invoke<void>('browser_start_picker', { label, themeColors });
}

export function browserStopPicker(projectId: string): Promise<void> {
  const label = getProjectBrowserLabel(projectId);
  return invoke<void>('browser_stop_picker', { label });
}

export function openInDefaultBrowser(url: string): Promise<void> {
  return invoke<void>('open_in_default_browser', { url });
}

import { invoke } from '@tauri-apps/api/core';

export function createBrowserWebview(
  url: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<string> {
  return invoke<string>('create_browser_webview', { url, x, y, width, height });
}

export function browserNavigate(label: string, url: string): Promise<void> {
  return invoke<void>('browser_navigate', { label, url });
}

export function browserSetBounds(
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  return invoke<void>('browser_set_bounds', { label, x, y, width, height });
}

export function browserOpenDevtools(label: string): Promise<void> {
  return invoke<void>('browser_open_devtools', { label });
}

export function browserClose(label: string): Promise<void> {
  return invoke<void>('browser_close', { label });
}

export function browserSetVisible(label: string, visible: boolean): Promise<void> {
  return invoke<void>('browser_set_visible', { label, visible });
}

export function browserGoBack(label: string): Promise<void> {
  return invoke<void>('browser_go_back', { label });
}

export function browserGoForward(label: string): Promise<void> {
  return invoke<void>('browser_go_forward', { label });
}

export function openInDefaultBrowser(url: string): Promise<void> {
  return invoke<void>('open_in_default_browser', { url });
}

export function browserStartPicker(
  label: string,
  themeColors?: Record<string, string>,
): Promise<void> {
  return invoke<void>('browser_start_picker', { label, themeColors });
}

export function browserStopPicker(label: string): Promise<void> {
  return invoke<void>('browser_stop_picker', { label });
}

import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { useCallback } from 'react';

import { MENU_PASTE_EVENT } from '@/shared/events';
import { useTauriEvent } from '@/shared/hooks/useTauriEvent';

function isTerminalTarget(el: HTMLElement | null): boolean {
  return !!el?.closest('.xterm, .xterm-helper-textarea');
}

async function handleMenuPaste(): Promise<void> {
  const activeEl = document.activeElement as HTMLElement | null;
  // 终端：xterm 的隐藏 textarea 消费原生 paste 事件并转发到 shell，
  // 保底走真实粘贴（macOS 此路径仍可能显示系统气泡，phase-1 接受）。
  if (isTerminalTarget(activeEl)) {
    document.execCommand('paste');
    return;
  }
  try {
    const text = await readText();
    if (!text) return;
    // insertText：标准文本插入路径，不弹系统粘贴气泡，且保留原生 undo/redo。
    document.execCommand('insertText', false, text);
  } catch {
    // 插件读取失败时回退到原生粘贴。
    document.execCommand('paste');
  }
}

/** 订阅 macOS 菜单「粘贴」事件，用剪贴板插件无气泡地插入文本。 */
export function useMenuPaste(): void {
  const onMenuPaste = useCallback(() => {
    void handleMenuPaste();
  }, []);
  useTauriEvent(MENU_PASTE_EVENT, onMenuPaste);
}

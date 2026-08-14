import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useCallback } from 'react';

import { useAppContext } from '@/shared/contexts';

/**
 * 统一复制：优先 Tauri 插件 writeText（免权限提示），失败回退
 * navigator.clipboard.writeText，仍失败则 toast 报错。永不抛异常。
 */
export function useCopyToClipboard(): (text: string, label?: string) => Promise<boolean> {
  const { showToast } = useAppContext();

  return useCallback(
    async (text: string, label?: string) => {
      const name = label ?? 'Content';
      try {
        await writeText(text);
        return true;
      } catch {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          showToast(`Failed to copy ${name} to clipboard`, 'error');
          return false;
        }
      }
    },
    [showToast],
  );
}

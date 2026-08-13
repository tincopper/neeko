import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useEffect } from 'react';

import { safeUnlisten } from '@/shared/utils/safeUnlisten';

/**
 * 订阅一个 Tauri 全局事件,自动管理 listen/unlisten 生命周期。
 *
 * - 组件卸载或 `event`/`handler` 变化时自动注销监听,防止事件监听泄漏。
 * - `handler` 应使用 `useCallback` 稳定引用,避免每次渲染重订阅。
 * - 竞态安全:异步 `listen` resolve 前卸载时,立即调用返回的 unlisten。
 */
export function useTauriEvent<T>(event: string, handler: (payload: T) => void): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<T>(event, (e) => {
      handler(e.payload);
    }).then((fn) => {
      if (cancelled) safeUnlisten(fn)();
      else unlisten = safeUnlisten(fn);
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [event, handler]);
}

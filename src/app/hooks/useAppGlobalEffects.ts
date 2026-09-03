import { useEffect } from 'react';

import { startQuickOpenActivityTracking } from '@/features/quick-open';
import { initScrollAutoHide } from '@/shared/utils/scrollAutoHide';

/** Idle-preload fallback delay when requestIdleCallback is unavailable. */
const LIBRARY_PRELOAD_DELAY_MS = 2000;
export function useAppGlobalEffects(): void {
  useEffect(() => {
    startQuickOpenActivityTracking();
  }, []);

  useEffect(() => initScrollAutoHide(), []);

  // Library chunk 空闲预载：首进不经过 Suspense fallback（启动零成本，打开零闪烁）
  useEffect(() => {
    const preload = () => {
      void import('@/app/dock/wrappers/LibraryPanelWrapper');
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(preload);
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(preload, LIBRARY_PRELOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
}

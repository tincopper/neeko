import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';

import { LSP_INSTALL_PROGRESS_EVENT } from '@/shared/events';
import { useLspStore, type LspInstallProgress } from '@/shared/store/lspStore';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

/**
 * 常驻数据桥（render null）：监听 `lsp-install-progress`，写入 lspStore 切片。
 * 原 StatusBar effect 原样迁移（done 2000ms / error 5000ms 清除 timer 语义保留）。
 * 禁止搬进互斥 item——item 按组 unmount 会丢 listener。
 */
export function InstallProgressBridge() {
  // Listen for auto-install progress events
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const setup = async () => {
      const fn = await listen<LspInstallProgress>(LSP_INSTALL_PROGRESS_EVENT, (event) => {
        if (cancelled) return;
        const { language_id, phase, message } = event.payload;
        if (phase === 'done' || phase === 'error') {
          setTimeout(
            () => useLspStore.getState().setInstallProgress(null),
            phase === 'done' ? 2000 : 5000,
          );
        }
        useLspStore.getState().setInstallProgress({ language_id, phase, message });
      });
      if (!cancelled) {
        unlisten = safeUnlisten(fn);
      }
    };

    setup();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return null;
}

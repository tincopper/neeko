import { useEffect, useRef } from 'react';

import { lspListSessions } from '@/features/lsp/api/lspApi';
import { useLspStore, type LspSessionState } from '@/shared/store/lspStore';
import { useProjectStore } from '@/shared/store/projectStore';

/**
 * 常驻数据桥（render null）：订阅 LSP 会话事件 + 拉取初始态 + soft-warm profile。
 * 原 StatusBar effect 原样迁移（先订阅后拉取防丢语义保留）。
 * 禁止搬进互斥 item——item 按组 unmount 会丢 listener。
 */
export function LspSubscriptionBridge() {
  const activeProjectPath = useProjectStore((s) => s.activeProject?.path);
  const subscribedRef = useRef<string | null>(null);

  // Subscribe to LSP session events + load initial state + soft-warm profile
  useEffect(() => {
    if (!activeProjectPath || subscribedRef.current === activeProjectPath) return;
    subscribedRef.current = activeProjectPath;

    const store = useLspStore.getState();
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    // Subscribe first, then poll — ensures events aren't lost between sub and poll
    store.subscribeToProject(activeProjectPath).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenFn = unlisten;
      // Now event listener is ready; fetch sessions already running
      lspListSessions().then((sessions) => {
        if (cancelled) return;
        for (const s of sessions) {
          if (s.project_path === activeProjectPath) {
            store.setSessionState(activeProjectPath, s.language_id, {
              serverName: s.server_name,
              status: s.status as LspSessionState['status'],
              statusMessage: s.status_message,
              progressPct: s.progress_pct,
            });
          }
        }
      });
    });

    // Detect profile + soft-warm primary (no server spawn)
    void store.onProjectActivated(activeProjectPath);

    return () => {
      cancelled = true;
      subscribedRef.current = null;
      unlistenFn?.();
    };
  }, [activeProjectPath]);

  return null;
}

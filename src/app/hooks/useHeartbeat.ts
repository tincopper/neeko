import { useEffect } from 'react';

import { heartbeat } from '@/app/api/heartbeatApi';

/** 默认心跳间隔（毫秒）。 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;

/**
 * 定期向 Rust 后端发送心跳，用于 WebView 崩溃检测。
 *
 * 渲染进程崩溃 / 冻结时，后端会因心跳超时自动 reload 窗口以恢复黑屏。
 * 心跳失败不阻断应用 —— 后端超时机制会兜底。
 */
export function useHeartbeat(intervalMs: number = DEFAULT_HEARTBEAT_INTERVAL_MS): void {
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        await heartbeat();
      } catch {
        // 忽略心跳失败；后端超时检测会兜底。
      }
    };

    // 立即发送一次，随后按固定间隔发送。
    void tick();
    const id = window.setInterval(tick, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [intervalMs]);
}

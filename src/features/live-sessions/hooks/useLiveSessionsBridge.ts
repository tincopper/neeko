import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';

import { SESSIONS_EVENT } from '@/shared/events';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

import { listLiveSessions, waitLiveSessions } from '../api/liveSessionsApi';

/** 长轮询挂起时长（后端把值钳进 1–30s，25s 是默认值 —— 前端不自造时长）。 */
const WAIT_TIMEOUT_MS = 25_000;

/**
 * 「没有任何推进」时的退避。
 *
 * 必要性：`wait_live_sessions` 说「变了」而随后的拉取失败（IPC 抖动 / 注册表被重建）时，
 * `since` 原地不动 ⇒ 下一次 wait 立刻再答「变了」—— 不加退避就是一个高速忙循环，
 * 而它的表现只是「CPU 高、日志刷」，根因极难定位。
 */
const RETRY_DELAY_MS = 1_000;

/** 事件载荷（Rust `SessionVersionPayload`）：只有版本号。 */
interface SessionVersionPayload {
  version: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * live-sessions 快照的**唯一**数据通道（全局挂载一次，见 `useAppShell`）。
 *
 * 三条通路互为兜底：
 * 1. **初次 hydrate** —— 先 `listen` 再拉，避免「拉完之后、监听之前」的变更被永久漏掉；
 * 2. **事件驱动** —— 收到 `SESSIONS_EVENT` 且版本更新时重拉（常态路径，延迟最低）；
 * 3. **长轮询** —— 事件丢失 / 漏发时仍能自愈（`wait_live_sessions` 版本未变则挂起，
 *    零空转；返回 `changed: false` 表示只是超时，**不重拉**）。
 *
 * 卸载时用 `cancelled` 标志收口：在途的 wait/list 结果一律丢弃，不再发起新调用
 * （React 严格模式的双挂载会让「卸载后仍调用」表现为重复 IPC 与状态竞态）。
 */
export function useLiveSessionsBridge(): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    /** 拉一次快照并应用（版本门在 store 内，这里不做第二份判断）。 */
    const refresh = async (): Promise<void> => {
      try {
        const snapshot = await listLiveSessions();
        if (cancelled) return;
        useLiveSessionsStore.getState().apply(snapshot);
      } catch (error) {
        console.warn('[live-sessions] list_live_sessions failed:', error);
      }
    };

    void listen<SessionVersionPayload>(SESSIONS_EVENT, (event) => {
      const version = event.payload?.version ?? 0;
      // 事件只说「有变更」，不代表服务端状态比本地新（乱序 / 重复投递都可能）
      if (version <= useLiveSessionsStore.getState().version) return;
      void refresh();
    }).then((fn) => {
      if (cancelled) {
        safeUnlisten(fn)();
        return;
      }
      unlisten = safeUnlisten(fn);
    });

    void refresh();

    void (async () => {
      while (!cancelled) {
        const since = useLiveSessionsStore.getState().version;
        let changed = false;
        let reported = since;
        try {
          const result = await waitLiveSessions(since, WAIT_TIMEOUT_MS);
          changed = result.changed;
          reported = result.version;
        } catch (error) {
          // 长轮询失败不是致命错误：退避后重试即可（快照仍可能由事件通道补上）
          console.warn('[live-sessions] wait_live_sessions failed:', error);
        }
        if (cancelled) return;

        // 变更可能已经由事件通道拉回来了（事件 + 长轮询会交叉）—— 只在本地仍落后于
        // **后端报的版本**时才重拉，避免同一版本连拉两次（每次都是一份完整快照）。
        if (changed && useLiveSessionsStore.getState().version < reported) {
          await refresh();
          if (cancelled) return;
        }

        // 超时（`changed === false`）= 期间没有任何变更，不算「没推进」——
        // 否则空闲期每 25s 白睡一秒。真正的「没推进」（报变了但拉不到）才退避，
        // 那是唯一会退化成忙循环的形态。
        const advanced = !changed || useLiveSessionsStore.getState().version > since;
        if (!advanced) await delay(RETRY_DELAY_MS);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      unlisten = null;
    };
  }, []);
}

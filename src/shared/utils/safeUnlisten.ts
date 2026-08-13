import type { UnlistenFn } from '@tauri-apps/api/event';

import { reportFrontendError } from '@/shared/utils/errorReporting';

/**
 * Tauri `listen()` 的注销竞态防护。
 *
 * tauri 注入脚本 `unregisterListener` 通过 `window['LISTENERS'][event][eventId]`
 * 读取 JS 侧事件表；该表由 `listen_js_script` 的 eval 填充，而 `listen()` 的
 * invoke 响应可能先于该 eval 落地返回。此时立即调用 unlisten 会命中
 * `listeners[eventId]` 缺失而同步抛错（async `_unlisten` reject →
 * unhandledrejection），且 `plugin:event|unlisten` 被跳过 → Rust 侧监听泄漏。
 *
 * 本包装：吞掉该竞态错误，延后一拍重试（事件表此时已填充，补执行 Rust 侧注销）；
 * 重试仍失败则走 `reportFrontendError`（带节流）兜底上报。同一包装实例只放行
 * 一次注销，重试在内部完成。
 */
export function safeUnlisten(unlisten: UnlistenFn): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const attempt = (retriesLeft: number): void => {
      try {
        void Promise.resolve(unlisten()).catch((err: unknown) => {
          if (retriesLeft > 0) {
            setTimeout(() => attempt(retriesLeft - 1), 0);
          } else {
            reportFrontendError('event.unlisten', err);
          }
        });
      } catch (err) {
        if (retriesLeft > 0) {
          setTimeout(() => attempt(retriesLeft - 1), 0);
        } else {
          reportFrontendError('event.unlisten', err);
        }
      }
    };
    attempt(UNLISTEN_RETRIES);
  };
}

/** 竞态重试次数：`listen()` 响应先于 eval 落地的窗口通常在一个事件循环内收敛。 */
const UNLISTEN_RETRIES = 2;

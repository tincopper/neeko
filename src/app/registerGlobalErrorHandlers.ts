import { logFrontendError } from '@/app/api/errorApi';
import { useNotificationStore } from '@/shared/store/notificationStore';

/** 同 source 错误上报的最小间隔（ms），防止一次崩溃风暴刷爆日志与提示。 */
const THROTTLE_MS = 5000;
/** 错误提示消息的最大长度，避免海量堆栈刷屏通知。 */
const MAX_MESSAGE_LENGTH = 200;

const lastReportAt: Record<string, number> = {};

/**
 * 全局错误兜底：捕获 window 级未处理错误与未处理 Promise rejection，
 * 记录到控制台、上报到 Rust 日志（`~/.neeko/neeko.log`）并展示用户提示，
 * 同时阻断默认行为避免黑屏。应用不退出、不重启，只让受影响功能报错。
 *
 * 返回 cleanup 函数用于移除监听。调用方（main.tsx）只注册一次。
 */
export function registerGlobalErrorHandlers(): () => void {
  const onError = (event: ErrorEvent) => {
    event.preventDefault();
    const error = event.error ?? new Error(event.message);
    console.error('[Global] Uncaught error:', error);
    reportFrontendError('window.error', error);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    event.preventDefault();
    console.error('[Global] Unhandled rejection:', event.reason);
    reportFrontendError('unhandledrejection', event.reason);
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/**
 * 重置节流状态。主要用于测试隔离；真实场景中亦可由设置面板调用以清空
 * 错误上报频率限制。
 */
export function resetFrontendErrorThrottle(): void {
  Object.keys(lastReportAt).forEach((key) => {
    delete lastReportAt[key];
  });
}

/**
 * 将前端错误上报到 Rust 日志 + 通知中心。带 source 级节流，
 * 上报链路的自身失败一律静默（避免二次崩溃）。
 */
export function reportFrontendError(source: string, error: unknown): void {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  const now = Date.now();
  const last = lastReportAt[source] ?? -Infinity;
  if (now - last < THROTTLE_MS) {
    return;
  }
  lastReportAt[source] = now;

  logFrontendError({
    source,
    message,
    stack: stack ?? null,
  }).catch(() => {
    // 上报链路自身失败必须静默，避免错误处理引发二次错误
  });

  useNotificationStore.getState().addNotification({
    type: 'error',
    title: '前端错误',
    message: message.slice(0, MAX_MESSAGE_LENGTH) || '发生未捕获错误',
  });
}

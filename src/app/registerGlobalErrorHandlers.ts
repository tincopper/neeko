import { useNotificationStore } from '@/shared/store/notificationStore';
import {
  reportFrontendError,
  resetFrontendErrorThrottle,
  setErrorNotifier,
} from '@/shared/utils/errorReporting';

export { reportFrontendError, resetFrontendErrorThrottle };

// 模块加载即注册 toast 提示：上报链路与用户提示解耦，shared/utils 不依赖 store
setErrorNotifier((message) => {
  useNotificationStore.getState().addNotification({
    type: 'error',
    title: '前端错误',
    message,
  });
});

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
    // ResizeObserver loop：WebKit 对「RO 通知投递后同帧又修改尺寸」的检测。
    // 复杂布局应用在拖动 panel / resize 场景即使无泄漏也会偶发（React
    // 社区共识为无害告警）。应用侧 RO 循环源已修复：TaskConsoleOutput RO
    // 守卫、TaskConsolePanel 只挂载 active、react-resizable-panels 升级
    // （lockfile 锁定 4.11.2）。此处仅静音该特定错误，不吞其他错误。
    const msg = event.message ?? '';
    if (/ResizeObserver loop (completed with undelivered notifications|limit exceeded)/.test(msg)) {
      return;
    }
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

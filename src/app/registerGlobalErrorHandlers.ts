/**
 * 全局错误兜底：捕获 window 级未处理错误与未处理 Promise rejection，
 * 记录到控制台，避免渲染进程崩溃后静默黑屏无从排查。
 *
 * 返回 cleanup 函数用于移除监听。调用方（main.tsx）只注册一次。
 */
export function registerGlobalErrorHandlers(): () => void {
  const onError = (event: ErrorEvent) => {
    event.preventDefault();
    console.error('[Global] Uncaught error:', event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    event.preventDefault();
    console.error('[Global] Unhandled rejection:', event.reason);
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

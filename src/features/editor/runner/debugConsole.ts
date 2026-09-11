/**
 * Debug 控制台输出与失败通知（构建失败证据的统一落点）。
 */
import { useDebugStore } from '@/features/debug/store/debugStore';
import { useNotificationStore } from '@/shared/store/notificationStore';

/** 构建日志尾部行数（§5：失败时附进 DebugPanel console，≤50 行）。 */
export const MAX_BUILD_LOG_TAIL_LINES = 50;

/** 构建日志尾部 → DebugPanel console（失败证据，失败分类 C2 的统一落点）。 */
export function pushBuildLogTail(output: string): void {
  const push = useDebugStore.getState().pushConsole;
  for (const line of output.split('\n').slice(-MAX_BUILD_LOG_TAIL_LINES)) {
    if (line.trim()) push('err', line);
  }
}

export function notifyDebugError(message: string): void {
  useNotificationStore.getState().addNotification({ type: 'error', title: 'Debug', message });
}

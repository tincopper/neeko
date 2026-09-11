/**
 * Debug 控制台输出与失败通知（构建失败证据的统一落点）。
 */
import { useDebugStore } from '@/features/debug/store/debugStore';
import { useNotificationStore } from '@/shared/store/notificationStore';

/** 构建日志尾部行数（§5：失败时附进 DebugPanel console，≤50 行）。 */
export const MAX_BUILD_LOG_TAIL_LINES = 50;

/**
 * 构建日志尾部 → DebugPanel console（失败证据，失败分类 C2 的统一落点）。
 *
 * 两流由后端**分开**采集（管道各自读取，无跨流时序保证）：stdout（cargo
 * `--message-format=json` / 编译输出）在前，stderr（go/cargo 的报错流）在后，
 * 合并后按行只保留尾部 N 行 —— go 构建失败时 stdout 为空，报错全在 stderr，
 * 不合并则失败原因完全不可见。
 */
export function pushBuildLogTail(stdout: string, stderr = ''): void {
  const push = useDebugStore.getState().pushConsole;
  const merged = stderr ? `${stdout}\n${stderr}` : stdout;
  for (const line of merged.split('\n').slice(-MAX_BUILD_LOG_TAIL_LINES)) {
    if (line.trim()) push('err', line);
  }
}

export function notifyDebugError(message: string): void {
  useNotificationStore.getState().addNotification({ type: 'error', title: 'Debug', message });
}

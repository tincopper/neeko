import { useCallback } from 'react';

import { GIT_OPERATION_OUTPUT_EVENT } from '@/shared/events';
import { useTauriEvent } from '@/shared/hooks/useTauriEvent';
import { useTaskStore } from '@/shared/store/taskStore';
import type { GitOperationOutputPayload } from '@/shared/types';

/**
 * App 级桥接：把 `git-operation-output` 事件路由进 payload.runId 指向的 Console tab。
 *
 * 挂载在 app shell（而非 Git 面板）：run 的生命周期归 task store 所有，
 * 面板卸载期间也必须继续收流（否则关闭面板的几分钟里输出会整段丢失）。
 */
export function useGitConsoleBridge(): void {
  const handler = useCallback((payload: GitOperationOutputPayload) => {
    useTaskStore.getState().appendGitConsoleOutput(payload.runId, payload.chunk);
  }, []);

  useTauriEvent<GitOperationOutputPayload>(GIT_OPERATION_OUTPUT_EVENT, handler);
}

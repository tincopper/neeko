import { useCallback, useState } from 'react';

import { invokeErrorMessage } from '@/shared/utils/invokeError';

import { retryTask as retryTaskCommand } from '../api/teamApi';
import { useTeamStore } from '../store/teamStore';

/**
 * 重试一个失败 / 冻结的任务的**执行**部分：`team_task_retry` → 就地刷新快照。
 *
 * # 为什么失败**不清任何状态**
 *
 * 被拒的重试意味着任务还在原地（`failed` / `blocked`），那是一个可查询、可再操作的真实
 * 状态。清空数据等于把「重试没成」藏起来；所以失败路径只做两件事：显示后端原文 +
 * 重取快照（重试失败也可能已经动了审计行，脉冲照发）。
 *
 * # 为什么成功要**手动补一次刷新**
 *
 * 写路径本来就发脉冲（`WriteGuard::drop`），但脉冲「不保证送达、不保证顺序」——
 * 面板无论如何都要能靠一次快照自愈，这里只是把那次自愈立刻做掉，不等脉冲。
 *
 * # 可重试判据不在这里
 *
 * 按钮渲染按 [`canRetry`](../utils/taskBoard.ts)（与后端状态门同源）。本 hook 对不可
 * 重试的任务照样把请求发出去 —— 后端的 `Conflict` 是权威答案，前端再判一遍就是第二套
 * 判据（后端集合一变，面板还在按老规则放行）。
 */
export interface TaskRetryOptions {
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
}

export interface TaskRetryState {
  /** 有请求在飞（按钮置灰，避免连点出并发的两个重试）。 */
  busy: boolean;
  /** 最近一次失败的后端原文（`AppError` 的可读字符串）；`null` = 没有错误。 */
  error: string | null;
  /**
   * 重试任务。
   *
   * @param teamId 任务所属团队（任务 id 只在队内唯一，两个参数一起给）。
   * @param taskId 任务 id。
   * @param assignee 可选改派；缺省 = 保留原指派。
   * @returns `true` = 后端确认已回 `pending`；`false` = 后端拒绝（原因在 `error` 里）。
   */
  retry: (teamId: string, taskId: string, assignee?: string | null) => Promise<boolean>;
}

export function useTaskRetry(options: TaskRetryOptions = {}): TaskRetryState {
  const { onShowToast } = options;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retry = useCallback(
    async (teamId: string, taskId: string, assignee?: string | null): Promise<boolean> => {
      if (busy) return false;
      setBusy(true);
      setError(null);
      try {
        await retryTaskCommand(teamId, taskId, assignee ?? null);
        onShowToast?.(`Task ${taskId} is back to unclaimed`, 'info');
        // 脉冲之外立刻补一次快照（见上：脉冲不保证送达）。
        if (useTeamStore.getState().teamId === teamId) {
          await useTeamStore.getState().refresh();
        }
        return true;
      } catch (err) {
        const message = invokeErrorMessage(err, `Could not retry task ${taskId}`);
        setError(message);
        onShowToast?.(message, 'error');
        // 任务还在原地：重取快照让真实状态可见，不清任何数据。
        if (useTeamStore.getState().teamId === teamId) {
          await useTeamStore.getState().refresh();
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, onShowToast],
  );

  return { busy, error, retry };
}

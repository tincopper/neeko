import { useCallback, useState } from 'react';

import { invokeErrorMessage } from '@/shared/utils/invokeError';

import { closeTeam as closeTeamCommand } from '../api/teamApi';
import { forgetTeamIfShowing, useTeamStore } from '../store/teamStore';

/**
 * 关闭团队的**执行**部分：`team_close` → 清空 store（仅当关的就是当前打开的那个队）。
 *
 * # 为什么失败**不清 store**
 *
 * 有成员关不掉时后端**整次调用 `Err`**，团队停在 `closing`，错误文本逐个点名。那是一个
 * 可查询、可重试的真实状态（`team_list` / `team_snapshot` 都还能看到 `closing`）。
 * 此时清空 store 等于把「关到一半」这件事藏起来：面板回到空态，用户以为关干净了，
 * 而成员进程还在跑。所以失败路径只做两件事：显示后端原文 + 重取快照/列表让 `closing` 可见。
 *
 * # 为什么成功**只清当前队**
 *
 * 面板可以关闭**不是当前打开的那个队**（列表行上的「关闭」）。无条件 `closeTeam()` 会把
 * 用户正盯着的那个队一起扔掉 —— 一次无关的清理动作变成了视角重置。
 *
 * # 为什么这里不自己刷新列表
 *
 * 列表状态在 [`useTeamList`](./useTeamList.ts)（宿主持有）：本 hook 只报「结束了一次关闭」，
 * 由宿主重取。让 hook 直接去开第二个 hook 的状态，就是同一份事实两个持有者。
 */

export interface CloseTeamOptions {
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  /**
   * 一次关闭请求落地后的通知（**成败都发**）。
   *
   * 成功 → 列表少一行；失败 → 那一行的徽标应当变成 `closing`。两种都要重取。
   */
  onSettled?: () => void;
}

export interface CloseTeamState {
  /** 有请求在飞（按钮置灰，避免连点出两个关闭编排）。 */
  busy: boolean;
  /** 最近一次失败的后端原文（`AppError` 的可读字符串）；`null` = 没有错误。 */
  error: string | null;
  /**
   * 整队关闭（`memberId` 缺省）。
   *
   * @param teamId 要关的团队。
   * @param name 团队显示名（**只**用于提示文案；关闭语义完全由后端判）。
   * @returns `true` = 后端确认已落 `closed`；`false` = 后端拒绝（原因在 `error` 里）。
   */
  close: (teamId: string, name: string) => Promise<boolean>;
}

export function useTeamClose(options: CloseTeamOptions = {}): CloseTeamState {
  const { onShowToast, onSettled } = options;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(
    async (teamId: string, name: string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await closeTeamCommand(teamId);
        // 只有「关的就是当前打开的那个队」才清空面板；否则只更新列表。
        // 这条规则的单一定义在 store（`forgetTeamIfShowing`），不在这里判。
        forgetTeamIfShowing(teamId);
        onShowToast?.(`Team "${name}" closed`, 'info');
        onSettled?.();
        return true;
      } catch (err) {
        // 后端错误原文（含逐个点名的成员）：面板照原样显示，不加工。
        const message = invokeErrorMessage(err, `Could not close team ${teamId}`);
        setError(message);
        onShowToast?.(message, 'error');
        // 团队停在 `closing`：不清 store，但要重取，让「正在关闭」这个真实状态出现在界面上。
        if (useTeamStore.getState().teamId === teamId) {
          await useTeamStore.getState().refresh();
        }
        onSettled?.();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onShowToast, onSettled],
  );

  return { busy, error, close };
}

import { useCallback, useState } from 'react';

import { invokeErrorMessage } from '@/shared/utils/invokeError';

import { deleteTeam as deleteTeamCommand } from '../api/teamApi';
import { forgetTeamIfShowing } from '../store/teamStore';

/**
 * 删除团队的**执行**部分：`team_delete` → 重取列表（失败时只显示后端原文）。
 *
 * # 与 [`useTeamClose`](./useTeamClose.ts) 的三处刻意差异
 *
 * | | `useTeamClose` | `useTeamDelete` |
 * | --- | --- | --- |
 * | 失败后重取什么 | 快照**和**列表（团队停在 `closing`，那个状态必须看得见）| **只有列表**（快照不会变：能删的队已经 `closed`，删失败意味着它还在，而它已经在列表里）|
 * | 成功后清 store | 只有「关的就是当前打开的那个队」才清 | **同一条判据**（共用 `forgetTeamIfShowing`），但触发频率不同：能删的是 `closed` 队，面板正盯着的那个队通常不是它 |
 * | 错误措辞 | 后端逐个点名的成员 | 后端原句（「先关闭」或「已经不存在」）|
 *
 * 第三行是本节的重点：`team_delete` 成功而面板正开着那个队时，**必须**把它从 store 里清掉
 * —— 否则下一次脉冲会去 `team_snapshot` 一个不存在的 id，面板会挂在一句 `NotFound` 上
 * （「删成功了，界面反而坏了」）。这条规则与关闭**完全同一条**，所以它的家是 store
 * （`forgetTeamIfShowing`），不是这里；两个 hook 各写一遍 `if` 就是两份拷贝，第三个人加
 * 第三个动作时会照抄其中一份。
 *
 * # 为什么这里不自己刷新列表
 *
 * 列表状态在 [`useTeamList`](./useTeamList.ts)（宿主持有）：本 hook 只报「结束了一次删除」，
 * 由宿主重取。让 hook 直接去开第二个 hook 的状态，就是同一份事实两个持有者。
 */

export interface DeleteTeamOptions {
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  /** 一次删除请求落地后的通知（**成败都发**：成功少一行，失败那一行还在，两种都要重取）。 */
  onSettled?: () => void;
}

export interface DeleteTeamState {
  /**
   * **正在删哪个队**（`null` = 没有删除在飞）。
   *
   * 不是 `busy: boolean`：删除是**按队**的动作，列表上同时存在多行。用全局布尔会让
   * 「删 A 的时候 B 的按钮也变灰」—— 而 B 的删除本来完全成立（后端 `delete_team` 按
   * `team_id` 定位，两行之间没有共享状态，锁只是让它们串行化，不是让其中一个非法）。
   * 全局 busy 还会让「我正在删哪一个」这件事在界面上不可见。
   */
  deletingTeamId: string | null;
  /** 最近一次失败的后端原文（`AppError` 的可读字符串）；`null` = 没有错误。 */
  error: string | null;
  /**
   * 删除一个**已关闭**的团队。
   *
   * @param teamId 要删的团队。
   * @param name 团队显示名（**只**用于提示文案；可删性完全由后端判）。
   * @returns `true` = 后端确认已删；`false` = 后端拒绝（原因在 `error` 里）。
   */
  remove: (teamId: string, name: string) => Promise<boolean>;
}

export function useTeamDelete(options: DeleteTeamOptions = {}): DeleteTeamState {
  const { onShowToast, onSettled } = options;
  const [deletingTeamId, setDeletingTeamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = useCallback(
    async (teamId: string, name: string): Promise<boolean> => {
      setDeletingTeamId(teamId);
      setError(null);
      try {
        await deleteTeamCommand(teamId);
        // 删的就是当前打开的那个队 ⇒ 必须清 store：否则下一次脉冲会去拉一个不存在的快照，
        // 面板会挂在一句 `NotFound` 上（那是「删成功了，界面反而坏了」）。
        // 规则本体在 store（`forgetTeamIfShowing`），与关闭共用同一个判据。
        forgetTeamIfShowing(teamId);
        onShowToast?.(`团队「${name}」已删除`, 'info');
        onSettled?.();
        return true;
      } catch (err) {
        // 后端错误原文（「先关闭」「已经不存在」）：面板照原样显示，不加工。
        const message = invokeErrorMessage(err, `Could not delete team ${teamId}`);
        setError(message);
        onShowToast?.(message, 'error');
        // 失败**不重取快照**：能删的队已经 `closed`，快照不会因为一次失败的删除而变。
        // 但列表要重取 —— 竞态下（另一窗口已经删了）那一行本该消失，用户得看到它真的不在了。
        onSettled?.();
        return false;
      } finally {
        // 只在自己还是「当前在飞的那个」时清：并发的第二次删除不该把第一次的标记抹掉。
        setDeletingTeamId((current) => (current === teamId ? null : current));
      }
    },
    [onShowToast, onSettled],
  );

  return { deletingTeamId, error, remove };
}

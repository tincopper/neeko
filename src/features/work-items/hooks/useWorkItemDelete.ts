/**
 * 删除 + 撤销窗口（把「删掉的那一行还能不能回来」这条规则收在一个地方）。
 *
 * # 撤销只有一条通道
 *
 * 删除后的 5 秒窗口由面板的 [`UndoBar`](../components/UndoBar.tsx) 独占 —— shared toast 是
 * 3 秒且没有动作按钮，两套计时器并排必然漂移（一个说「还能撤销」，另一个已经收起了入口）。
 * 所以本 hook 只维护「窗口里那一条的标题」，计时归 `UndoBar`。
 *
 * # 以 `undoDelete()` 的**返回值**结算
 *
 * `undo()` 返回 `false` = 窗口已过（那次删除已经真的提交了）→ 只收起条子，**不**提示成功。
 * 用「条子还亮着」当判据是不成立的：条子的计时器与 store 的定时器是两个钟，它们之间那几十毫秒
 * 正好是「点了撤销、后端已经删掉」的窗口 —— 那时说要骗用户「已恢复」。
 *
 * # 为什么不是每个 provider 一份
 *
 * 撤销窗口写的是**本地库**的延迟删除（`store.deleteWithUndo`）。外部 provider 本期只读，
 * 没有删除动作，也就没有窗口 —— 所以这里只接 `WorkItemsActions`，不预留 provider 参数。
 */

import { useCallback, useState } from 'react';

import { invokeErrorMessage } from '@/shared/utils/invokeError';

import type { ShowToast } from './useRunSingleWorkItem';
import type { WorkItemsActions } from './useWorkItems';

export interface UseWorkItemDeleteResult {
  /** 撤销条上的标题（`null` = 没有打开的窗口）。 */
  pendingTitle: string | null;
  /** 删除并打开撤销窗口。调用方负责先收起详情（本 hook 不持有选中态）。 */
  remove: (id: string, title: string) => void;
  undo: () => void;
  /** 窗口到点：收起条子（不做任何提交 —— 提交是 store 的定时器在管）。 */
  dismiss: () => void;
}

export function useWorkItemDelete(
  actions: WorkItemsActions,
  showToast: ShowToast,
): UseWorkItemDeleteResult {
  /** 撤销条的内容：被删标题（文案要点名，5 秒窗口里这是唯一的核对依据）。 */
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);

  const remove = useCallback(
    (id: string, title: string) => {
      actions.remove(id).then(
        () => setPendingTitle(title),
        (err: unknown) => showToast(invokeErrorMessage(err, '删除工作项失败'), 'error'),
      );
    },
    [actions, showToast],
  );

  const undo = useCallback(() => {
    const restored = actions.undo();
    setPendingTitle(null);
    if (restored) showToast('已恢复工作项');
  }, [actions, showToast]);

  const dismiss = useCallback(() => setPendingTitle(null), []);

  return { pendingTitle, remove, undo, dismiss };
}

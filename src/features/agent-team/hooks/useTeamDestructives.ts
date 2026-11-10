import { useCallback, useState } from 'react';

import type { TeamRef } from '@/shared/types/team';

import { useTeamClose } from './useTeamClose';
import { useTeamDelete } from './useTeamDelete';

/**
 * 两个**破坏性动作**（关闭 / 删除团队）的组合点：确认状态 + 两个执行 hook + 唯一分派。
 *
 * # 为什么抽出来
 *
 * 「弹窗问什么」与「确认后做什么」是一条完整的职责链，与面板的其它读路径（列表 / 快照 /
 * 中央 tab）没有共同变化理由。分派**只在这里**：弹窗不知道关闭与删除的差异，两个 hook
 * 也不认识对方，本 hook 是它们唯一的共同祖先。
 *
 * 判据表（二次确认 / 失败不清 store / closing 横幅可重试）见 `TeamConfirmDialog` 与
 * `useTeamClose` / `useTeamDelete` 的文档 —— 本文件只做组合。
 */
export function useTeamDestructives(options: {
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  onSettled: () => void;
}) {
  /** 待确认的**破坏性**动作（关闭 / 删除）；`null` = 弹窗关闭。 */
  const [pendingAction, setPendingAction] = useState<
    (TeamRef & { kind: 'close' | 'delete' }) | null
  >(null);

  const {
    busy: closing,
    error: closeError,
    close,
  } = useTeamClose({
    onShowToast: options.onShowToast,
    onSettled: options.onSettled,
  });

  const {
    deletingTeamId,
    error: deleteError,
    remove,
  } = useTeamDelete({
    onShowToast: options.onShowToast,
    onSettled: options.onSettled,
  });

  const handleRequestClose = useCallback((team: TeamRef) => {
    setPendingAction({ kind: 'close', teamId: team.teamId, name: team.name });
  }, []);

  const handleRequestDelete = useCallback((team: TeamRef) => {
    setPendingAction({ kind: 'delete', teamId: team.teamId, name: team.name });
  }, []);

  const handleCancelAction = useCallback(() => {
    setPendingAction(null);
  }, []);

  const handleConfirmAction = useCallback(() => {
    const target = pendingAction;
    setPendingAction(null);
    if (!target) return;
    if (target.kind === 'delete') {
      void remove(target.teamId, target.name);
      return;
    }
    void close(target.teamId, target.name);
  }, [pendingAction, close, remove]);

  return {
    pendingAction,
    closing,
    closeError,
    deleteError,
    deletingTeamId,
    handleRequestClose,
    handleRequestDelete,
    handleCancelAction,
    handleConfirmAction,
  };
}

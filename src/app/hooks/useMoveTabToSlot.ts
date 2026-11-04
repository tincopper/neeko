import { useCallback } from 'react';

import { useAppContext } from '@/shared/contexts';
import type { DockSlot } from '@/shared/dock';

import { moveTabToSlot } from '../utils/tabSurface';

/**
 * tab → surface 的用户入口适配层（右键菜单 / 未来命令面板共用）。
 *
 * 编排本身只有一处（`app/utils/tabSurface.moveTabToSlot`）；本 hook 只负责把 `false`
 * 翻译成用户可见的提示。**为什么不静默**：失败里包含 R9 的 pinned 拒绝 —— 静默会让
 * 用户以为移动成功（或以为菜单坏了）。
 */
export function useMoveTabToSlot(
  tabKey: string | null,
): (tabId: string, target: 'center' | DockSlot) => void {
  const { showToast } = useAppContext();

  return useCallback(
    (tabId: string, target: 'center' | DockSlot) => {
      if (!tabKey) return;
      if (moveTabToSlot(tabKey, tabId, target)) return;
      showToast('Cannot move this tab', 'error');
    },
    [showToast, tabKey],
  );
}

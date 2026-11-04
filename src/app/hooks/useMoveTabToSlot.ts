import { useCallback, useMemo } from 'react';

import { useAppContext } from '@/shared/contexts';
import type { DockSlot } from '@/shared/dock';
import { useEditorStore } from '@/shared/store/editorStore';

import { canDockTabKind, moveTabToSlot } from '../utils/tabSurface';

export interface MoveTabToSlotPort {
  /** 移动 tab 到某个 surface（右键菜单 / 命令面板共用）。 */
  move: (tabId: string, target: 'center' | DockSlot) => void;
  /** 该 tab 能否停靠 —— 菜单据此决定**出不出现**（而不是出现后点不动）。 */
  canDock: (tabId: string) => boolean;
}

/**
 * tab → surface 的用户入口适配层。
 *
 * 编排本身只有一处（`app/utils/tabSurface.moveTabToSlot`）；本 hook 只负责两件事：
 * 把 `false` 翻译成用户可见的提示（失败里包含 R9 的 pinned 拒绝 —— 静默会让用户以为
 * 移动成功），以及把 `canDockTabKind` 这条种类策略接到菜单上。
 */
export function useMoveTabToSlot(tabKey: string | null): MoveTabToSlotPort {
  const { showToast } = useAppContext();

  const move = useCallback(
    (tabId: string, target: 'center' | DockSlot) => {
      if (!tabKey) return;
      if (moveTabToSlot(tabKey, tabId, target)) return;
      showToast('Cannot move this tab', 'error');
    },
    [showToast, tabKey],
  );

  const canDock = useCallback(
    (tabId: string) => {
      if (!tabKey) return false;
      const tab = useEditorStore.getState().tabs[tabKey]?.tabs.find((t) => t.id === tabId);
      return tab ? canDockTabKind(tab.data.kind) : false;
    },
    [tabKey],
  );

  return useMemo(() => ({ move, canDock }), [move, canDock]);
}

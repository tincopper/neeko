import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ContextMenuItem } from '@/features/project';
import type { DockSlot } from '@/shared/dock';
import { useOverlayStore } from '@/shared/store/overlayStore';
import type { EditorPaneId } from '@/shared/types';

/** tab 右键菜单浮层 id（z-order 专项）。 */
const CONTEXT_MENU_OVERLAY_ID = 'tab-context-menu';

interface UsePaneContextMenuParams {
  paneId: EditorPaneId;
  /**
   * tab → 槽位（唯一跨 store 编排点由 app 注入：`app/utils/tabSurface.moveTabToSlot`）。
   * 缺省 = 不提供「移到 dock/中心」菜单项（组件级测试与未接线的宿主）。
   */
  onMoveTabToSlot?: (tabId: string, target: 'center' | DockSlot) => void;
  /**
   * 该 tab 能不能停靠（app 注入，按种类判定：只有带功能入口的种类允许）。
   * 缺省 false —— 菜单**不出现**这一项，而不是出现了点不动。
   */
  canDockTab?: (tabId: string) => boolean;
  onCloseTab: (tabId: string) => void;
  onCloseOtherTabs?: (tabId: string) => void;
  onCloseAllTabs?: () => void;
  onSplitRight?: (tabId: string) => void;
  onMoveToRight?: (tabId: string) => void;
  onMoveToLeft?: (tabId: string) => void;
  onUnpinTab?: (tabId: string) => void;
  onPinTab?: (tabId: string) => void;
  pinnedTabs?: { id: string }[];
  onFocusGroup: () => void;
}

/**
 * EditorGroupPane 的 tab 右键菜单：状态、菜单项构建与关闭。
 */
export function usePaneContextMenu({
  paneId,
  onMoveTabToSlot,
  canDockTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onSplitRight,
  onMoveToRight,
  onMoveToLeft,
  onUnpinTab,
  onPinTab,
  pinnedTabs = [],
  onFocusGroup,
}: UsePaneContextMenuParams) {
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(
    null,
  );

  // 兜底：pane 在菜单打开状态下被卸载（切项目/关 pane）时清除自身 overlay id，
  // 避免 overlayStore.count 永久 >0 导致 Browser webview 一直隐藏。
  useEffect(() => {
    return () => useOverlayStore.getState().setOverlayOpen(CONTEXT_MENU_OVERLAY_ID, false);
  }, []);

  const closeContextMenu = useCallback(() => {
    useOverlayStore.getState().setOverlayOpen(CONTEXT_MENU_OVERLAY_ID, false);
    setContextMenu(null);
  }, []);

  // Build context menu extras inline based on groupId
  const resolveContextMenuExtras = useCallback(
    (tabId: string): ContextMenuItem[] => {
      if (paneId === 'pinned') {
        return [{ label: 'Unpin Tab', action: () => onUnpinTab?.(tabId) }];
      }
      const isPinnedTab = pinnedTabs.some((t) => t.id === tabId);
      if (isPinnedTab) {
        return [{ label: 'Unpin Tab', action: () => onUnpinTab?.(tabId) }];
      }
      return [{ label: 'Pin Tab', action: () => onPinTab?.(tabId) }];
    },
    [paneId, pinnedTabs, onUnpinTab, onPinTab],
  );

  const handleTabContextMenu = useCallback(
    (tabId: string, e: React.MouseEvent) => {
      e.preventDefault();
      // 浮层上报：菜单打开期间隐藏内容区 Browser webview（z-order 专项）
      useOverlayStore.getState().setOverlayOpen(CONTEXT_MENU_OVERLAY_ID, true);
      setContextMenu({ tabId, x: e.clientX, y: e.clientY });
      onFocusGroup();
    },
    [onFocusGroup],
  );

  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!contextMenu) return [];
    const { tabId } = contextMenu;

    const isInRight = paneId === 'right';
    const isPinnedGroup = paneId === 'pinned';
    const isDocked = paneId === 'dockLeft' || paneId === 'dockRight';
    const isPinnedTab = pinnedTabs.some((t) => t.id === tabId);

    // Pin panel: delegate entirely to extras (Layout provides Unpin)
    if (isPinnedGroup) {
      return resolveContextMenuExtras(tabId);
    }

    const items: ContextMenuItem[] = [{ label: 'Close', action: () => onCloseTab(tabId) }];
    if (onCloseOtherTabs) {
      items.push({ label: 'Close Others', action: () => onCloseOtherTabs(tabId) });
    }
    if (onCloseAllTabs) {
      items.push({ label: 'Close All', action: () => onCloseAllTabs() });
    }
    if (!isDocked) {
      items.push({ separator: true } as ContextMenuItem);
      if (!isInRight) {
        items.push({ label: 'Split Right', action: () => onSplitRight?.(tabId) });
        items.push({ label: 'Move to Right', action: () => onMoveToRight?.(tabId) });
      } else {
        items.push({ label: 'Move to Left', action: () => onMoveToLeft?.(tabId) });
      }
    }

    // tab → 槽位（P1）：只在合法时出现。pinned tab 一律不出现（R9：拒绝而非静默 unpin）；
    // 「已经在的地方」不出现（拖/移到当前 surface 是 no-op，列出来只会让菜单变吵）。
    if (onMoveTabToSlot && !isPinnedTab && canDockTab?.(tabId) === true) {
      const dockTargets: { label: string; target: 'center' | DockSlot }[] = [];
      if (paneId !== 'dockLeft') dockTargets.push({ label: 'Move to Left Dock', target: 'left' });
      if (paneId !== 'dockRight')
        dockTargets.push({ label: 'Move to Right Dock', target: 'right' });
      if (isDocked) dockTargets.push({ label: 'Move to Center', target: 'center' });
      if (dockTargets.length > 0) {
        items.push({ separator: true } as ContextMenuItem);
        for (const item of dockTargets) {
          items.push({ label: item.label, action: () => onMoveTabToSlot(tabId, item.target) });
        }
      }
    }

    // Layout-injected extras (e.g. Pin Tab)
    const extras = resolveContextMenuExtras(tabId);
    if (extras && extras.length > 0) {
      items.push({ separator: true } as ContextMenuItem);
      items.push(...extras);
    }
    return items;
  }, [
    contextMenu,
    paneId,
    pinnedTabs,
    onCloseTab,
    onCloseOtherTabs,
    onCloseAllTabs,
    onSplitRight,
    onMoveToRight,
    onMoveToLeft,
    onMoveTabToSlot,
    canDockTab,
    resolveContextMenuExtras,
  ]);

  return {
    contextMenu,
    closeContextMenu,
    contextMenuItems,
    handleTabContextMenu,
  };
}

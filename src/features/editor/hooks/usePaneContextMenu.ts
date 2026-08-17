import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ContextMenuItem } from '@/features/project';
import { useOverlayStore } from '@/shared/store/overlayStore';
import type { EditorGroupId } from '@/shared/types';

/** tab 右键菜单浮层 id（z-order 专项）。 */
const CONTEXT_MENU_OVERLAY_ID = 'tab-context-menu';

interface UsePaneContextMenuParams {
  groupId: EditorGroupId | 'pinned';
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
  groupId,
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
      if (groupId === 'pinned') {
        return [{ label: 'Unpin Tab', action: () => onUnpinTab?.(tabId) }];
      }
      const isPinnedTab = pinnedTabs.some((t) => t.id === tabId);
      if (isPinnedTab) {
        return [{ label: 'Unpin Tab', action: () => onUnpinTab?.(tabId) }];
      }
      return [{ label: 'Pin Tab', action: () => onPinTab?.(tabId) }];
    },
    [groupId, pinnedTabs, onUnpinTab, onPinTab],
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

    const isInRight = groupId === 'right';
    const isPinnedGroup = groupId === 'pinned';

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
    items.push({ separator: true } as ContextMenuItem);
    if (!isInRight) {
      items.push({ label: 'Split Right', action: () => onSplitRight?.(tabId) });
      items.push({ label: 'Move to Right', action: () => onMoveToRight?.(tabId) });
    } else {
      items.push({ label: 'Move to Left', action: () => onMoveToLeft?.(tabId) });
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
    groupId,
    onCloseTab,
    onCloseOtherTabs,
    onCloseAllTabs,
    onSplitRight,
    onMoveToRight,
    onMoveToLeft,
    resolveContextMenuExtras,
  ]);

  return {
    contextMenu,
    closeContextMenu,
    contextMenuItems,
    handleTabContextMenu,
  };
}

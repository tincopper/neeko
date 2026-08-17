import { useCallback, useEffect, useState } from 'react';

import { useOverlayStore } from '@/shared/store/overlayStore';

const ACTION_MENU_OVERLAY_ID = 'action-menu';

export interface ActionMenuResult {
  actionMenuRect: DOMRect | null;
  openActionMenu: (rect: DOMRect) => void;
  closeActionMenu: () => void;
}

/** 编辑器 tab bar 的 action menu 开关状态 */
export function useActionMenu(): ActionMenuResult {
  const [actionMenuRect, setActionMenuRect] = useState<DOMRect | null>(null);

  // 兜底：菜单所属 pane/组件在打开状态下被卸载（切项目/关 pane）时，
  // 仍清除自身 overlay id，避免 overlayStore.count 永久 >0 导致 Browser webview 一直隐藏。
  useEffect(() => {
    return () => useOverlayStore.getState().setOverlayOpen(ACTION_MENU_OVERLAY_ID, false);
  }, []);

  const openActionMenu = useCallback((rect: DOMRect) => {
    // 浮层上报：菜单打开期间隐藏内容区的 Browser webview（z-order 专项）
    useOverlayStore.getState().setOverlayOpen(ACTION_MENU_OVERLAY_ID, true);
    setActionMenuRect(rect);
  }, []);

  const closeActionMenu = useCallback(() => {
    useOverlayStore.getState().setOverlayOpen(ACTION_MENU_OVERLAY_ID, false);
    setActionMenuRect(null);
  }, []);

  return { actionMenuRect, openActionMenu, closeActionMenu };
}

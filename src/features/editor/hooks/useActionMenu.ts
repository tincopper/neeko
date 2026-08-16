import { useCallback, useState } from 'react';

export interface ActionMenuResult {
  actionMenuRect: DOMRect | null;
  openActionMenu: (rect: DOMRect) => void;
  closeActionMenu: () => void;
}

/** 编辑器 tab bar 的 action menu 开关状态 */
export function useActionMenu(): ActionMenuResult {
  const [actionMenuRect, setActionMenuRect] = useState<DOMRect | null>(null);

  const openActionMenu = useCallback((rect: DOMRect) => {
    setActionMenuRect(rect);
  }, []);

  const closeActionMenu = useCallback(() => {
    setActionMenuRect(null);
  }, []);

  return { actionMenuRect, openActionMenu, closeActionMenu };
}

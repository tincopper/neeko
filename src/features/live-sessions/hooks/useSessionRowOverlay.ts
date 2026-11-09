import { useCallback, useState, type FocusEvent } from 'react';

/**
 * 会话行 hover 覆盖槽的 UI 状态机：菜单开合或键盘聚焦都能独立强制显示，
 * 父组件只消费派生的 `showActions`，不镜像后端资源状态。
 */
export function useSessionRowOverlay() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionsFocused, setActionsFocused] = useState(false);
  const showActions = menuOpen || actionsFocused;

  const handleActionsFocus = useCallback(() => setActionsFocused(true), []);
  const handleActionsBlur = useCallback((e: FocusEvent<HTMLDivElement>) => {
    // 焦点仍在覆盖槽内部时不收起（给槽内将来新增按钮留出空间）。
    if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) {
      setActionsFocused(false);
    }
  }, []);

  return { showActions, setMenuOpen, handleActionsFocus, handleActionsBlur };
}

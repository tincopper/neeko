import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 右键菜单开/关状态与外部点击关闭。
 *
 * 菜单 DOM 渲染在 CommitListItem 内；menuRef 经组合层下传（ref drilling）。
 */
export function useCommitMenu() {
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 外部点击关闭
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const openMenu = useCallback((hash: string) => setMenuOpen(hash), []);
  const closeMenu = useCallback(() => setMenuOpen(null), []);
  const isMenuOpen = useCallback((hash: string) => menuOpen === hash, [menuOpen]);

  return { menuOpen, menuRef, openMenu, closeMenu, isMenuOpen };
}

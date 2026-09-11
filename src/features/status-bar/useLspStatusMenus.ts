/** LSP 状态栏下拉 / 子菜单的状态机：开关、portal 定位、外部点击 / Esc 关闭。
 *
 * 抽自 `LspStatusSection`（容器逻辑下沉，见 AGENTS.md 前端约定）。
 * 仅负责"菜单怎么开、开在哪、怎么关"，不含任何 LSP 会话操作。
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

import { lspGetServerInfo, type LspServerInfo } from '@/features/lsp/api/lspApi';
import { usePresence, useOnlyAfterMount, useReducedMotion } from '@/shared/hooks/usePresence';

export function useLspStatusMenus(activeProjectPath: string | undefined) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | undefined>(undefined);
  const [activeSubmenuLanguageId, setActiveSubmenuLanguageId] = useState<string | null>(null);
  const [submenuStyle, setSubmenuStyle] = useState<CSSProperties | undefined>(undefined);
  const [submenuInfo, setSubmenuInfo] = useState<LspServerInfo | null>(null);
  const [submenuInfoLoading, setSubmenuInfoLoading] = useState(false);
  const [infoForLanguageId, setInfoForLanguageId] = useState<string | null>(null);

  // Render-time reset when the active submenu server changes. This is the
  // React-recommended way to reset derived state on dependency change, keeping
  // the fetch effect free of synchronous setState calls.
  if (activeSubmenuLanguageId !== infoForLanguageId) {
    setInfoForLanguageId(activeSubmenuLanguageId);
    setSubmenuInfo(null);
    setSubmenuInfoLoading(!!activeSubmenuLanguageId);
  }

  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const closeTimerRef = useRef<number | null>(null);

  const reducedMotion = useReducedMotion();

  // Main dropdown presence (enter/exit animation).
  const dropdownPresence = usePresence(dropdownOpen);
  // Submenu presence (enter/exit animation).
  const submenuPresence = usePresence(dropdownOpen && !!activeSubmenuLanguageId, () => {
    setActiveSubmenuLanguageId(null);
    setSubmenuInfo(null);
  });
  // Gate position transitions to after-mount so the submenu doesn't animate
  // into place on first open.
  const submenuPositionReady = useOnlyAfterMount();

  const clearCloseTimer = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const closeAll = useCallback(() => {
    clearCloseTimer();
    setDropdownOpen(false);
    setActiveSubmenuLanguageId(null);
    setSubmenuInfo(null);
    setSubmenuStyle(undefined);
  }, []);

  // Position main dropdown from chip button.
  useEffect(() => {
    if (dropdownOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
        minWidth: 220,
      });
    } else {
      setDropdownStyle(undefined);
    }
  }, [dropdownOpen]);

  // Position submenu from active server row.
  // The submenu portal is gated by `activeSession`, so a stale style when no
  // submenu is active is harmless — no render-time reset needed here.
  useEffect(() => {
    if (!activeSubmenuLanguageId) {
      return;
    }
    const el = rowRefs.current[activeSubmenuLanguageId];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Auto-width: let content breathe between 260–360px.
    const minWidth = 260;
    const maxWidth = 360;
    const preferRight = rect.right + 4;
    const left =
      preferRight + minWidth > window.innerWidth
        ? Math.max(8, rect.left - minWidth - 4)
        : preferRight;
    setSubmenuStyle({
      position: 'fixed',
      top: Math.max(8, rect.top),
      left,
      minWidth,
      maxWidth,
    });
  }, [activeSubmenuLanguageId, dropdownOpen]);

  // Fetch server info when submenu opens. State resets happen at render time
  // above; this effect only updates state inside async callbacks.
  useEffect(() => {
    if (!activeSubmenuLanguageId || !activeProjectPath) {
      return;
    }
    let cancelled = false;
    void lspGetServerInfo(activeProjectPath, activeSubmenuLanguageId)
      .then((info) => {
        if (!cancelled) setSubmenuInfo(info);
      })
      .catch((e) => {
        console.warn('[LSP] get_server_info failed:', e);
        if (!cancelled) setSubmenuInfo(null);
      })
      .finally(() => {
        if (!cancelled) setSubmenuInfoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSubmenuLanguageId, activeProjectPath]);

  // Outside click closes both menus.
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef.current?.contains(target) ||
        (target as Element).closest?.('[data-lsp-dropdown]') ||
        (target as Element).closest?.('[data-lsp-submenu]')
      ) {
        return;
      }
      closeAll();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen, closeAll]);

  // Escape closes menus.
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAll();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [dropdownOpen, closeAll]);

  const openSubmenu = (languageId: string) => {
    clearCloseTimer();
    setActiveSubmenuLanguageId(languageId);
  };

  const scheduleCloseSubmenu = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setActiveSubmenuLanguageId(null);
      setSubmenuInfo(null);
    }, 180);
  };

  return {
    dropdownOpen,
    setDropdownOpen,
    dropdownStyle,
    dropdownRef,
    buttonRef,
    rowRefs,
    activeSubmenuLanguageId,
    submenuStyle,
    submenuInfo,
    submenuInfoLoading,
    dropdownPresence,
    submenuPresence,
    submenuPositionReady,
    reducedMotion,
    closeAll,
    clearCloseTimer,
    openSubmenu,
    scheduleCloseSubmenu,
  };
}

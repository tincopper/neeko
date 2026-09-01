import React, { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { Tab } from '@/shared/types/tab';

/** 菜单与锚点按钮的间距 */
const ANCHOR_GAP = 4;
/** 菜单最大高度（与窗口高度取小） */
const MAX_MENU_HEIGHT = 320;
/** 视口安全边距 */
const VIEWPORT_PADDING = 8;

interface TabOverflowMenuProps {
  /** 隐藏（溢出）的 tab 列表 */
  tabs: Tab[];
  /** 「⋯」按钮元素：定位贴住按钮，窗口缩放时跟随重算 */
  anchorEl: HTMLElement;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onClose: () => void;
  /** 渲染 tab 前导内容（图标 / dirty 点 / 状态点），复用 TabItem 的 leading */
  renderLeading?: (tab: Tab) => React.ReactNode;
}

/**
 * Tab 栏溢出收纳下拉：列出被挤出 tab 栏的 tab。
 * 点击项激活该 tab（按溢出规则进入可见区）；× 直接关闭隐藏 tab。
 * 定位：默认在锚点下方右对齐；下方空间不足时向上翻转；window resize 时跟随重算。
 */
const TabOverflowMenu: React.FC<TabOverflowMenuProps> = ({
  tabs,
  anchorEl,
  onActivateTab,
  onCloseTab,
  onClose,
  renderLeading,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  const computeStyle = useCallback((): React.CSSProperties => {
    const rect = anchorEl.getBoundingClientRect();
    const right = Math.max(VIEWPORT_PADDING, window.innerWidth - rect.right);
    const maxHeight = Math.min(MAX_MENU_HEIGHT, Math.floor(window.innerHeight * 0.5));
    // 预估菜单高度：行高 ~32px + 标题/底部提示 ~60px，用于上下翻转决策
    const estimatedHeight = Math.min(maxHeight, tabs.length * 32 + 60);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    if (
      rect.bottom + ANCHOR_GAP + estimatedHeight > window.innerHeight - VIEWPORT_PADDING &&
      spaceAbove > spaceBelow
    ) {
      // 下方放不下 → 向上翻转（底边贴锚点顶部）
      return { bottom: window.innerHeight - rect.top + ANCHOR_GAP, right, maxHeight };
    }
    return { top: rect.bottom + ANCHOR_GAP, right, maxHeight };
  }, [anchorEl, tabs.length]);

  const [style, setStyle] = useState(computeStyle);

  useEffect(() => {
    const updateStyle = () => setStyle(computeStyle());
    window.addEventListener('resize', updateStyle);
    return () => window.removeEventListener('resize', updateStyle);
  }, [computeStyle]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !anchorEl.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, anchorEl]);

  const handleActivate = useCallback(
    (tabId: string) => {
      onActivateTab(tabId);
      onClose();
    },
    [onActivateTab, onClose],
  );

  const handleCloseTab = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation();
      onCloseTab(tabId);
    },
    [onCloseTab],
  );

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed min-w-[220px] max-w-[300px] flex flex-col z-[10000] bg-popover border border-border rounded-lg shadow-xl py-1"
      style={style}
    >
      {/* 分组标题 + 数量徽标 */}
      <div className="shrink-0 px-3 pt-1.5 pb-1 flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-text-muted">
          Hidden Tabs
        </span>
        <span className="text-[10px] leading-none text-text-muted bg-bg-primary border border-border rounded-full px-1.5 py-0.5 font-mono">
          {tabs.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-1 pb-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="menuitem"
            tabIndex={-1}
            className="group flex items-center gap-2 mx-1 px-2 py-1.5 rounded-md text-[var(--font-size)] text-text-secondary cursor-pointer select-none transition-colors duration-150 hover:bg-bg-hover hover:text-text-primary"
            onClick={() => handleActivate(tab.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleActivate(tab.id);
              }
            }}
            title={tab.title}
          >
            {renderLeading?.(tab)}
            <span className="flex-1 min-w-0 truncate">{tab.title}</span>
            <button
              className="tb-icon-btn w-4 h-4 rounded text-text-muted hover:text-[#e06c75] hover:bg-bg-primary transition-colors flex items-center justify-center shrink-0 leading-none opacity-0 group-hover:opacity-100"
              style={{ fontSize: 'var(--terminal-font-size)' }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => handleCloseTab(e, tab.id)}
              title="Close tab"
              aria-label={`Close ${tab.title}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div
        className={cn(
          'shrink-0 px-3 py-1.5 border-t border-border',
          'text-[10px] text-text-muted flex items-center justify-between',
        )}
      >
        <span>Click to open</span>
        <span>esc close</span>
      </div>
    </div>
  );
};

export default React.memo(TabOverflowMenu);

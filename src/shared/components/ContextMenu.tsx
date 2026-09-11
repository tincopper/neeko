import React, { useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';
import { LucideIcon } from '@/shared/components/icons';

export type ContextMenuItem =
  | { separator: true }
  | {
      separator?: false;
      label: string;
      action: () => void;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      icon?: LucideIcon;
    };

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ items, position, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const pos = useMemo(() => {
    const menuWidth = 220;
    const menuHeight = items.length * 32;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    // 下界夹到 4：菜单高于视口时（如动态子测试可能数十项）仍从顶部可见，溢出部分由
    // 容器 max-height + overflow-y 滚动兜住，避免 top 变负把整个菜单推到视口之上。
    return {
      left: position.x + menuWidth > winW ? Math.max(4, winW - menuWidth - 4) : position.x,
      top: position.y + menuHeight > winH ? Math.max(4, winH - menuHeight - 4) : position.y,
    };
  }, [position, items.length]);

  // portal 到 body：菜单可能从深层容器（dock 面板，祖先常带 transform/overflow-hidden）
  // 触发——树内渲染时 fixed 定位会被祖先 containing block 劫持并裁剪，菜单不可见。
  // 与 tooltips(parent: body)/popover/dialog 等 app 浮层惯例一致。
  // max-height + overflow-y：动态子测试条目数不定，超长时改为滚动而非溢出视口。
  return createPortal(
    <div
      ref={menuRef}
      className="fixed bg-bg-tertiary border border-border rounded-md min-w-[200px] z-[10000] shadow-[0_4px_16px_rgba(0,0,0,0.5)] overflow-hidden py-1"
      style={{ left: pos.left, top: pos.top, maxHeight: 'calc(100vh - 8px)', overflowY: 'auto' }}
    >
      {items.map((item, idx) =>
        item.separator === true ? (
          <div key={idx} className="h-px bg-border my-1" />
        ) : (
          <div
            key={idx}
            role="menuitem"
            tabIndex={-1}
            className={cn(
              'flex items-center justify-between px-3.5 py-1.5 text-[0.9em] text-text-primary cursor-pointer transition-[background-color] duration-100 select-none hover:bg-bg-hover',
              item.danger && 'text-[#e06c75] hover:bg-accent-red/15',
              item.disabled && 'opacity-40 cursor-default pointer-events-none',
            )}
            onClick={() => {
              if (!item.disabled) {
                item.action();
                onClose();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (!item.disabled) {
                  item.action();
                  onClose();
                }
              }
            }}
          >
            {item.icon && <item.icon size={14} style={{ marginRight: 8, opacity: 0.7 }} />}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="text-[0.85em] text-text-muted ml-4 font-mono">{item.shortcut}</span>
            )}
          </div>
        ),
      )}
    </div>,
    document.body,
  );
};

export default React.memo(ContextMenu);

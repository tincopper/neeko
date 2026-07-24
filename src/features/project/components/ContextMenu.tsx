import React, { useEffect, useRef, useMemo } from "react";
import { LucideIcon } from "@/shared/components/icons"
import { cn } from '@/lib/utils';

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
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const pos = useMemo(() => {
    const menuWidth = 220;
    const menuHeight = items.length * 32;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    return {
      left: position.x + menuWidth > winW ? winW - menuWidth - 4 : position.x,
      top: position.y + menuHeight > winH ? winH - menuHeight - 4 : position.y,
    };
  }, [position, items.length]);

  return (
    <div
      ref={menuRef}
      className="fixed bg-bg-tertiary border border-border rounded-md min-w-[200px] z-[10000] shadow-[0_4px_16px_rgba(0,0,0,0.5)] overflow-hidden py-1"
      style={{ left: pos.left, top: pos.top }}
    >
      {items.map((item, idx) =>
        item.separator === true ? (
          <div key={idx} className="h-px bg-border my-1" />
        ) : (
          <div
            key={idx}
            className={cn(
              "flex items-center justify-between px-3.5 py-1.5 text-[0.9em] text-text-primary cursor-pointer transition-[background-color] duration-100 select-none hover:bg-bg-hover",
              item.danger && "text-[#e06c75] hover:bg-accent-red/15",
              item.disabled && "opacity-40 cursor-default pointer-events-none"
            )}
            onClick={() => {
              if (!item.disabled) {
                item.action();
                onClose();
              }
            }}
          >
            {item.icon && <item.icon size={14} style={{ marginRight: 8, opacity: 0.7 }} />}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="text-[0.85em] text-text-muted ml-4 font-mono">{item.shortcut}</span>
            )}
          </div>
        )
      )}
    </div>
  );
};

export default React.memo(ContextMenu);
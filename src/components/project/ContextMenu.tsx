import React, { useEffect, useRef, useMemo } from "react";
import { LucideIcon } from "lucide-react";

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  icon?: LucideIcon;
}

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
      className="gh-context-menu"
      style={{ left: pos.left, top: pos.top }}
    >
      {items.map((item, idx) =>
        item.separator ? (
          <div key={idx} className="gh-context-separator" />
        ) : (
          <div
            key={idx}
            className={`gh-context-menu-item${item.danger ? " gh-context-menu-item-danger" : ""}${item.disabled ? " gh-context-menu-item-disabled" : ""}`}
            onClick={() => {
              if (!item.disabled) {
                item.action();
                onClose();
              }
            }}
          >
            {item.icon && <item.icon size={14} style={{ marginRight: 8, opacity: 0.7 }} />}
            <span className="gh-context-menu-label">{item.label}</span>
            {item.shortcut && (
              <span className="gh-context-menu-shortcut">{item.shortcut}</span>
            )}
          </div>
        )
      )}
    </div>
  );
};

export default React.memo(ContextMenu);

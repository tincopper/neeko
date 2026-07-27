import React, { useCallback } from 'react';

import { cn } from '@/lib/utils';

import type { ActionRegistryItem } from '../types/actionMenu';

interface ActionMenuItemProps {
  item: ActionRegistryItem;
  selected: boolean;
  onSelect: () => void;
}

const ActionMenuItem: React.FC<ActionMenuItemProps> = ({ item, selected, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect();
  }, [onSelect]);

  const Icon = item.icon;

  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 text-left border-0 bg-transparent cursor-pointer transition-colors duration-150',
        selected ? 'bg-accent-blue/15 text-text-primary' : 'text-text-secondary hover:bg-bg-hover',
        item.disabled && 'opacity-40 pointer-events-none',
      )}
      disabled={item.disabled}
      onClick={handleClick}
    >
      <Icon size={16} className="shrink-0 text-text-muted" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            'text-[var(--font-size)] font-medium truncate',
            selected && 'text-text-primary',
          )}
        >
          {item.label}
        </div>
        {item.description && (
          <div className="text-[11px] text-text-muted truncate">{item.description}</div>
        )}
      </div>
      {item.shortcut && (
        <kbd className="shrink-0 text-[10px] text-text-muted bg-bg-primary px-1.5 py-0.5 rounded font-mono">
          {item.shortcut}
        </kbd>
      )}
    </button>
  );
};

export default React.memo(ActionMenuItem);

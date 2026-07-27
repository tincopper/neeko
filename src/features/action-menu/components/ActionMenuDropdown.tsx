import React, { useEffect, useRef, useMemo } from 'react';

import AgentIcon from '@/features/agent/components/AgentIcon';
import { cn } from '@/lib/utils';

import { useActionMenu } from '../hooks/useActionMenu';
import type { ActionContext, ActionRegistryItem, ActionGroup } from '../types/actionMenu';

import ActionMenuItem from './ActionMenuItem';

interface ActionMenuDropdownProps {
  items: ActionRegistryItem[];
  ctx: ActionContext;
  anchorRect: DOMRect | null;
  onClose: () => void;
  onExecute: (item: ActionRegistryItem) => void;
  onAddAgentTerminal?: (agentId: string, agentName: string) => void;
}

const GROUP_LABELS: Record<ActionGroup, string> = {
  terminal: 'Terminal',
  agent: 'Agent',
  file: 'File',
  quick: 'Quick Actions',
};

const ActionMenuDropdown: React.FC<ActionMenuDropdownProps> = ({
  items,
  ctx,
  anchorRect,
  onClose,
  onExecute,
  onAddAgentTerminal,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { query, setQuery, filtered, selectedIndex, handleKeyDown } = useActionMenu(
    items,
    {
      ...ctx,
      closeMenu: onClose,
    },
    onExecute,
  );

  useEffect(() => {
    if (anchorRect) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [anchorRect]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [onClose]);

  const grouped = useMemo(() => {
    const map = new Map<ActionGroup, ActionRegistryItem[]>();
    for (const item of filtered) {
      const list = map.get(item.group);
      if (list) list.push(item);
      else map.set(item.group, [item]);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const style = useMemo(() => {
    if (!anchorRect) return { display: 'none' as const };
    const menuWidth = 300;
    const gap = 4;
    let left = anchorRect.left;
    let top = anchorRect.bottom + gap;

    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }
    if (left < 8) left = 8;

    const maxHeight = Math.min(window.innerHeight * 0.5, 480);
    if (top + maxHeight > window.innerHeight - 8) {
      top = anchorRect.top - maxHeight - gap;
    }
    if (top < 8) top = 8;

    return { left, top, width: menuWidth, maxHeight };
  }, [anchorRect]);

  const handleItemSelect = (item: ActionRegistryItem) => {
    onExecute(item);
    onClose();
  };

  const agentItems = useMemo(() => ctx.agents.filter((a) => a.enabled), [ctx.agents]);

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      className="fixed z-[1000] bg-popover border border-border rounded-md shadow-xl flex flex-col overflow-hidden"
      style={style}
      onKeyDown={handleKeyDown}
    >
      <div className="shrink-0 px-2 pt-2 pb-1.5">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search actions…"
          className={cn(
            'w-full px-2.5 py-1.5 rounded-md text-[var(--font-size)]',
            'bg-bg-primary border border-border text-text-primary',
            'placeholder:text-text-muted outline-none focus:border-accent-blue',
          )}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {grouped.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-text-muted">No matches</div>
        ) : (
          grouped.map(([group, groupItems]) => (
            <div key={group}>
              <div className="px-3 py-1 text-[10.5px] font-bold tracking-[0.12em] uppercase text-text-muted">
                {GROUP_LABELS[group]}
              </div>
              {group === 'agent' && query === '' && agentItems.length > 0 && (
                <div className="px-2 py-1">
                  {agentItems.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      role="menuitem"
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-left border-0 bg-transparent cursor-pointer text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors duration-150 text-[var(--font-size)]"
                      onClick={() => {
                        onAddAgentTerminal?.(agent.id, agent.name);
                        onClose();
                      }}
                    >
                      <AgentIcon icon={agent.icon} />
                      <span>{agent.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {groupItems.map((item) => {
                const globalIdx = filtered.indexOf(item);
                return (
                  <ActionMenuItem
                    key={item.id}
                    item={item}
                    selected={selectedIndex === globalIdx}
                    onSelect={() => handleItemSelect(item)}
                  />
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 px-3 py-1.5 border-t border-border text-[10px] text-text-muted flex gap-3">
        <span>↑↓ navigate</span>
        <span>↵ select</span>
        <span>esc close</span>
      </div>
    </div>
  );
};

export default React.memo(ActionMenuDropdown);

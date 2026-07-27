import React, { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle } from '@/ui/Dialog';

import { getAllActions } from '../actionRegistry';
import { useActionMenu } from '../hooks/useActionMenu';
import { useActionPaletteStore } from '../store/actionPaletteStore';
import type { ActionRegistryItem, ActionContext } from '../types/actionMenu';

interface ActionPaletteProps {
  ctx: ActionContext;
  onExecute: (item: ActionRegistryItem) => void;
}

const ActionPalette: React.FC<ActionPaletteProps> = ({ ctx, onExecute }) => {
  const open = useActionPaletteStore((s) => s.open);
  const closePalette = useActionPaletteStore((s) => s.closePalette);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const paletteCtx: ActionContext = { ...ctx, closeMenu: closePalette };
  const allItems = getAllActions();
  const { query, setQuery, filtered, selectedIndex, setSelectedIndex, handleKeyDown } =
    useActionMenu(allItems, paletteCtx);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const onPaletteKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape') {
      handleKeyDown(e);
    }
  };

  const handleConfirm = () => {
    if (filtered[selectedIndex]) {
      onExecute(filtered[selectedIndex]);
      closePalette();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) closePalette();
      }}
    >
      <DialogContent
        className="max-w-[560px] p-0 gap-0 overflow-hidden"
        showCloseButton={false}
        onKeyDown={onPaletteKeyDown}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <div className="px-3 pt-3 pb-2 border-b border-border">
          <div className="text-[11px] uppercase tracking-wide text-text-muted mb-1.5 px-0.5">
            Command Palette
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command…"
            className={cn(
              'w-full px-3 py-2 rounded-md text-[13px]',
              'bg-bg-primary border border-border text-text-primary',
              'placeholder:text-text-muted outline-none focus:border-accent-blue',
            )}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div ref={listRef} className="max-h-[min(360px,50vh)] overflow-y-auto py-1" role="listbox">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-text-muted">No matches</div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-idx={idx}
                  role="option"
                  aria-selected={idx === selectedIndex}
                  className={cn(
                    'w-full text-left px-3 py-2 flex items-center gap-2.5 cursor-pointer border-0 bg-transparent',
                    idx === selectedIndex
                      ? 'bg-accent-blue/15 text-text-primary'
                      : 'text-text-secondary hover:bg-bg-hover',
                  )}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    setSelectedIndex(idx);
                    handleConfirm();
                  }}
                >
                  <Icon size={16} className="shrink-0 text-text-muted" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate">{item.label}</div>
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
            })
          )}
        </div>
        <div className="px-3 py-1.5 border-t border-border text-[10px] text-text-muted flex gap-3">
          <span>↑↓ navigate</span>
          <span>↵ execute</span>
          <span>esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default React.memo(ActionPalette);

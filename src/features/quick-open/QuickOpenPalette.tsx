/**
 * IDEA-like Quick Open palette (Goto File / Recent Files / Tab Switcher).
 */
import React, { useEffect, useRef } from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog';
import { cn } from '@/lib/utils';

import {
  quickOpenTitle,
  useQuickOpenStore,
} from './quickOpenStore';

export function QuickOpenPalette() {
  const open = useQuickOpenStore((s) => s.open);
  const mode = useQuickOpenStore((s) => s.mode);
  const query = useQuickOpenStore((s) => s.query);
  const items = useQuickOpenStore((s) => s.items);
  const selectedIndex = useQuickOpenStore((s) => s.selectedIndex);
  const loading = useQuickOpenStore((s) => s.loading);
  const setQuery = useQuickOpenStore((s) => s.setQuery);
  const moveSelection = useQuickOpenStore((s) => s.moveSelection);
  const confirm = useQuickOpenStore((s) => s.confirm);
  const closePalette = useQuickOpenStore((s) => s.closePalette);
  const confirmTabSwitcher = useQuickOpenStore((s) => s.confirmTabSwitcher);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ctrlHeldRef = useRef(false);

  useEffect(() => {
    if (open) {
      // Defer focus so dialog portal mounts
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Tab switcher: release Ctrl/Meta → confirm selection (IDEA-like)
  useEffect(() => {
    if (!open || mode !== 'tabSwitcher') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        ctrlHeldRef.current = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        if (ctrlHeldRef.current && useQuickOpenStore.getState().open) {
          confirmTabSwitcher();
        }
        ctrlHeldRef.current = false;
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [open, mode, confirmTabSwitcher]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void confirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
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
        data-quick-open
        onKeyDown={onKeyDown}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{quickOpenTitle(mode)}</DialogTitle>
        <div className="px-3 pt-3 pb-2 border-b border-border">
          <div className="text-[11px] uppercase tracking-wide text-text-muted mb-1.5 px-0.5">
            {quickOpenTitle(mode)}
            {loading ? ' · loading…' : ''}
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === 'gotoFile'
                ? 'Type a file name…'
                : mode === 'recentFiles'
                  ? 'Filter recent files…'
                  : 'Filter tabs…'
            }
            className={cn(
              'w-full px-3 py-2 rounded-md text-[13px]',
              'bg-bg-primary border border-border text-text-primary',
              'placeholder:text-text-muted outline-none focus:border-accent-blue',
            )}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div
          ref={listRef}
          className="max-h-[min(360px,50vh)] overflow-y-auto py-1"
          role="listbox"
        >
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-text-muted">
              {loading ? 'Indexing project files…' : 'No matches'}
            </div>
          ) : (
            items.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                data-idx={idx}
                role="option"
                aria-selected={idx === selectedIndex}
                className={cn(
                  'w-full text-left px-3 py-2 flex flex-col gap-0.5 cursor-pointer border-0 bg-transparent',
                  idx === selectedIndex
                    ? 'bg-accent-blue/15 text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover',
                )}
                onMouseEnter={() => useQuickOpenStore.setState({ selectedIndex: idx })}
                onClick={() => {
                  useQuickOpenStore.setState({ selectedIndex: idx });
                  void confirm();
                }}
              >
                <span className="text-[13px] font-medium truncate">{item.label}</span>
                {item.description && item.description !== item.label ? (
                  <span className="text-[11px] text-text-muted truncate font-mono">
                    {item.description}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
        <div className="px-3 py-1.5 border-t border-border text-[10px] text-text-muted flex gap-3">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          {mode === 'tabSwitcher' ? <span>release Ctrl to switch</span> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default QuickOpenPalette;

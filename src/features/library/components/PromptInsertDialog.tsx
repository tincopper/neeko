import { CornerDownLeft, Search, Terminal, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import { cn } from '@/lib/utils';
import type { PromptInsertTarget, PromptResource } from '@/shared/types/library';
import { Dialog, DialogContent, DialogTitle } from '@/ui/Dialog';

interface PromptInsertDialogProps {
  /** Called when the user confirms a prompt to insert. */
  onInsert: (prompt: PromptResource, target?: PromptInsertTarget) => void;
}

const PromptInsertDialog: React.FC<PromptInsertDialogProps> = React.memo(({ onInsert }) => {
  const open = useLibraryStore((s) => s.insertOpen);
  const closeInsert = useLibraryStore((s) => s.closeInsert);
  const prompts = useLibraryStore((s) => s.prompts);
  const refreshPrompts = useLibraryStore((s) => s.refreshPrompts);

  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      if (prompts.length === 0) {
        void refreshPrompts();
      }
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, prompts.length, refreshPrompts]);

  const filtered = useMemo(() => {
    const list = prompts;
    if (!query.trim()) return list.slice(0, 20);
    const q = query.toLowerCase();
    return list
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.slash?.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)),
      )
      .slice(0, 20);
  }, [prompts, query]);

  const handleConfirm = useCallback(
    (target: PromptInsertTarget = 'agent') => {
      const prompt = filtered[selectedIdx];
      if (prompt) {
        onInsert(prompt, target);
        closeInsert();
      }
    },
    [filtered, selectedIdx, onInsert, closeInsert],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((prev) => (prev + 1) % Math.max(filtered.length, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((prev) => (prev - 1 + filtered.length) % Math.max(filtered.length, 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        // Shift+Enter inserts to terminal; plain Enter inserts to agent.
        handleConfirm(e.shiftKey ? 'terminal' : 'agent');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeInsert();
      }
    },
    [filtered.length, handleConfirm, closeInsert],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) closeInsert();
      }}
    >
      <DialogContent
        className="max-w-[520px] p-0 gap-0 overflow-hidden"
        showCloseButton={false}
        onKeyDown={handleKeyDown}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Insert Prompt</DialogTitle>
        <div className="px-3 pt-3 pb-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIdx(0);
              }}
              placeholder="Search prompts by name, slash, tag…"
              className={cn(
                'w-full h-8 pl-8 pr-8 text-[var(--font-size)] rounded-md',
                'bg-bg-primary border border-border text-text-primary',
                'outline-none focus:border-accent-blue placeholder:text-text-muted',
              )}
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-text-muted hover:text-text-primary"
                onClick={() => setQuery('')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="max-h-[min(320px,45vh)] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-[var(--font-size)] text-text-muted">
              {prompts.length === 0 ? 'No prompts yet' : 'No matches'}
            </div>
          ) : (
            filtered.map((prompt, idx) => (
              <button
                key={prompt.id}
                type="button"
                className={cn(
                  'w-full text-left px-3 py-2 flex items-center gap-2.5 cursor-pointer',
                  idx === selectedIdx
                    ? 'bg-accent-blue/15 text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover',
                )}
                onMouseEnter={() => setSelectedIdx(idx)}
                onClick={() => {
                  setSelectedIdx(idx);
                  onInsert(prompt, 'agent');
                  closeInsert();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSelectedIdx(idx);
                  onInsert(prompt, 'terminal');
                  closeInsert();
                }}
                title="Left-click: insert to agent · Right-click / Shift+Enter: insert to terminal"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {prompt.slash && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-hover text-text-muted border border-border">
                        /{prompt.slash}
                      </span>
                    )}
                    <span className="text-[var(--font-size)] font-medium truncate">
                      {prompt.name}
                    </span>
                  </div>
                  {prompt.description && (
                    <div className="text-[11px] text-text-muted truncate mt-0.5">
                      {prompt.description}
                    </div>
                  )}
                </div>
                <CornerDownLeft className="h-3.5 w-3.5 text-text-muted shrink-0" />
              </button>
            ))
          )}
        </div>
        <div className="px-3 py-1.5 border-t border-border text-[10px] text-text-muted flex gap-3">
          <span>↑↓ navigate</span>
          <span>↵ insert to agent</span>
          <span>
            <Terminal className="h-2.5 w-2.5 inline" /> ⇧↵ / right-click → terminal
          </span>
          <span>esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
});

PromptInsertDialog.displayName = 'PromptInsertDialog';

export default PromptInsertDialog;

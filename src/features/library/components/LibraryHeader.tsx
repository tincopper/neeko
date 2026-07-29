import { LayoutGrid, List, Plus, Save, Search, X } from 'lucide-react';
import React, { useCallback } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import { cn } from '@/lib/utils';

interface LibraryHeaderProps {
  /** Number of items currently displayed (for the count badge). */
  count: number;
  /** Label for the active filter context. */
  filterLabel?: string;
}

/** Read the current line from the active terminal (the "agent input"). */
function readAgentInput(): string | null {
  const read = (window as unknown as { __neekoReadAgentInput?: () => string | null })
    .__neekoReadAgentInput;
  return read ? read() : null;
}

const LibraryHeader: React.FC<LibraryHeaderProps> = React.memo(({ count, filterLabel }) => {
  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);
  const activeKind = useLibraryStore((s) => s.activeKind);
  const viewMode = useLibraryStore((s) => s.viewMode);
  const toggleViewMode = useLibraryStore((s) => s.toggleViewMode);
  const openEditor = useLibraryStore((s) => s.openEditor);
  const openEditorWithContent = useLibraryStore((s) => s.openEditorWithContent);

  const handleNew = useCallback(() => {
    openEditor(null);
  }, [openEditor]);

  const handleSaveAsPrompt = useCallback(() => {
    const content = readAgentInput();
    if (content && content.trim()) {
      openEditorWithContent(content.trim());
    } else {
      // Nothing typed — open an empty editor so the user can still create one.
      openEditor(null);
    }
  }, [openEditor, openEditorWithContent]);

  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex items-center gap-2 h-11 px-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
          <input
            className={cn(
              'w-full h-7 pl-8 pr-8 text-[var(--font-size)] rounded-md',
              'bg-bg-hover/60 border border-border text-text-primary',
              'outline-none focus:border-accent-blue placeholder:text-text-muted',
            )}
            placeholder="Search prompts…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-text-muted hover:text-text-primary"
              onClick={() => setSearchQuery('')}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            className={cn(
              'h-7 w-7 rounded-md flex items-center justify-center transition-colors',
              viewMode === 'grid'
                ? 'bg-bg-selected text-text-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover',
            )}
            onClick={toggleViewMode}
            title="Grid view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={cn(
              'h-7 w-7 rounded-md flex items-center justify-center transition-colors',
              viewMode === 'list'
                ? 'bg-bg-selected text-text-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover',
            )}
            onClick={toggleViewMode}
            title="List view"
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
        {activeKind === 'prompt' && (
          <button
            type="button"
            className="h-7 px-2.5 text-[11px] font-medium rounded-md bg-bg-hover text-text-secondary hover:text-text-primary flex items-center gap-1 shrink-0 border border-border"
            onClick={handleSaveAsPrompt}
            title="Save current agent input as a prompt"
          >
            <Save className="h-3.5 w-3.5" />
            Save as Prompt
          </button>
        )}
        <button
          type="button"
          className="h-7 px-2.5 text-[11px] font-medium rounded-md bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 flex items-center gap-1 shrink-0"
          onClick={handleNew}
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>
      {count > 0 && (
        <div className="px-3 pb-1.5 flex items-center gap-2">
          <span className="text-[11px] text-text-muted tabular-nums">{count}</span>
          {filterLabel && (
            <span className="text-[11px] text-text-muted truncate">{filterLabel}</span>
          )}
        </div>
      )}
    </div>
  );
});

LibraryHeader.displayName = 'LibraryHeader';

export default LibraryHeader;

import {
  ArrowDownUp,
  Download,
  LayoutGrid,
  List,
  Plus,
  Save,
  Search,
  Upload,
  X,
} from 'lucide-react';
import React, { useCallback, useState } from 'react';

import { useLibraryStore, type SortMode } from '@/features/library/store/libraryStore';
import { cn } from '@/lib/utils';
import { useNotificationStore } from '@/shared/store/notificationStore';

import { exportLibraryBundle, importLibraryBundle } from '../api/libraryApi';

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

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'frequent', label: 'Most Used' },
  { value: 'alphabetical', label: 'A-Z' },
];

const LibraryHeader: React.FC<LibraryHeaderProps> = React.memo(({ count, filterLabel }) => {
  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);
  const activeKind = useLibraryStore((s) => s.activeKind);
  const viewMode = useLibraryStore((s) => s.viewMode);
  const toggleViewMode = useLibraryStore((s) => s.toggleViewMode);
  const openEditor = useLibraryStore((s) => s.openEditor);
  const openEditorWithContent = useLibraryStore((s) => s.openEditorWithContent);
  const openActionEditor = useLibraryStore((s) => s.openActionEditor);
  const sortMode = useLibraryStore((s) => s.sortMode);
  const setSortMode = useLibraryStore((s) => s.setSortMode);

  const [sortOpen, setSortOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const openMcpEditor = useLibraryStore((s) => s.openMcpEditor);

  const handleNew = useCallback(() => {
    if (activeKind === 'action') {
      openActionEditor(null);
    } else if (activeKind === 'mcp') {
      openMcpEditor(null);
    } else if (activeKind === 'command') {
      openEditor(null, 'command');
    } else {
      openEditor(null);
    }
  }, [activeKind, openEditor, openActionEditor, openMcpEditor]);

  const handleSaveAsPrompt = useCallback(() => {
    const content = readAgentInput();
    if (content && content.trim()) {
      openEditorWithContent(content.trim());
    } else {
      // Nothing typed — open an empty editor so the user can still create one.
      openEditor(null);
    }
  }, [openEditor, openEditorWithContent]);

  const handleExport = useCallback(async () => {
    try {
      // Use the Tauri save dialog via the dialog plugin.
      const { save } = await import('@tauri-apps/plugin-dialog');
      const filePath = await save({
        defaultPath: 'neeko-library.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (filePath) {
        await exportLibraryBundle(filePath);
        useNotificationStore.getState().addNotification({
          type: 'info',
          title: 'Exported',
          message: 'Library exported successfully',
        });
      }
    } catch (e) {
      useNotificationStore.getState().addNotification({
        type: 'error',
        title: 'Export Failed',
        message: String(e),
      });
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const filePath = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (filePath && typeof filePath === 'string') {
        const result = await importLibraryBundle(filePath, 'skip');
        useNotificationStore.getState().addNotification({
          type: 'info',
          title: 'Imported',
          message: `Imported ${result.promptsImported} prompts, ${result.actionsImported} actions (${result.promptsSkipped + result.actionsSkipped} skipped)`,
        });
      }
    } catch (e) {
      useNotificationStore.getState().addNotification({
        type: 'error',
        title: 'Import Failed',
        message: String(e),
      });
    } finally {
      setImporting(false);
    }
  }, [importing]);

  const searchPlaceholders: Record<string, string> = {
    skill: 'Search skills…',
    prompt: 'Search prompts…',
    action: 'Search actions…',
    mcp: 'Search MCP servers…',
    command: 'Search commands…',
  };
  const searchPlaceholder = searchPlaceholders[activeKind] ?? 'Search…';

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
            placeholder={searchPlaceholder}
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

        {/* Sort dropdown */}
        <div className="relative shrink-0">
          <button
            type="button"
            className={cn(
              'h-7 w-7 rounded-md flex items-center justify-center transition-colors',
              'text-text-muted hover:text-text-primary hover:bg-bg-hover',
            )}
            onClick={() => setSortOpen((v) => !v)}
            title="Sort"
          >
            <ArrowDownUp className="h-3.5 w-3.5" />
          </button>
          {sortOpen && (
            <div
              className="absolute right-0 top-full mt-1 w-36 rounded-md border border-border bg-popover shadow-lg py-1 z-10"
              onMouseLeave={() => setSortOpen(false)}
            >
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={cn(
                    'w-full text-left px-2.5 py-1.5 text-[var(--font-size)]',
                    sortMode === opt.value
                      ? 'bg-accent-blue/15 text-accent-blue'
                      : 'text-text-secondary hover:bg-bg-hover',
                  )}
                  onClick={() => {
                    setSortMode(opt.value);
                    setSortOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
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

        {/* Import / Export (prompts tab) */}
        {activeKind === 'prompt' && (
          <>
            <button
              type="button"
              className="h-7 w-7 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover flex items-center justify-center shrink-0"
              onClick={() => void handleImport()}
              title="Import library"
            >
              <Upload className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="h-7 w-7 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover flex items-center justify-center shrink-0"
              onClick={() => void handleExport()}
              title="Export library"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        <button
          type="button"
          className="h-7 px-2.5 text-[11px] font-medium rounded-md bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 flex items-center gap-1 shrink-0"
          onClick={handleNew}
        >
          <Plus className="h-3.5 w-3.5" />
          New
          {activeKind === 'mcp' ? ' Server' : activeKind === 'command' ? ' Command' : ''}
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

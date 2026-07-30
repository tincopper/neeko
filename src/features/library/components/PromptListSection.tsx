import { ChevronDown, CornerDownLeft, Copy, Pencil, Star, Terminal, Trash2 } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import { useNotificationStore } from '@/shared/store/notificationStore';
import type { PromptInsertTarget, PromptResource } from '@/shared/types/library';

interface PromptListSectionProps {
  /** Called when the user picks a prompt to insert (primary action). */
  onInsert?: (prompt: PromptResource, target?: PromptInsertTarget) => void;
}

const PromptListSection: React.FC<PromptListSectionProps> = React.memo(({ onInsert }) => {
  const prompts = useLibraryStore((s) => s.prompts);
  const loading = useLibraryStore((s) => s.promptsLoading);
  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const tagFilter = useLibraryStore((s) => s.tagFilter);
  const scopeFilter = useLibraryStore((s) => s.scopeFilter);
  const viewMode = useLibraryStore((s) => s.viewMode);
  const sortMode = useLibraryStore((s) => s.sortMode);
  const openEditor = useLibraryStore((s) => s.openEditor);
  const deletePrompt = useLibraryStore((s) => s.deletePrompt);

  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = prompts;
    if (scopeFilter === 'global') {
      list = list.filter((p) => p.scope === 'global');
    } else if (scopeFilter === 'project') {
      list = list.filter((p) => p.scope === 'project');
    }
    if (tagFilter.length > 0) {
      list = list.filter((p) => tagFilter.some((t) => p.tags.includes(t)));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          p.content.toLowerCase().includes(q) ||
          p.slash?.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (sortMode === 'alphabetical') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortMode === 'frequent') {
      list.sort((a, b) => b.usageCount - a.usageCount);
    } else {
      list.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return list;
  }, [prompts, scopeFilter, tagFilter, searchQuery, sortMode]);

  const handleCopy = useCallback((content: string) => {
    void navigator.clipboard.writeText(content).then(() => {
      useNotificationStore.getState().addNotification({
        type: 'info',
        title: 'Copied',
        message: 'Prompt copied to clipboard',
      });
    });
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deletePrompt(id);
        setPendingDeleteId(null);
      } catch (e) {
        useNotificationStore.getState().addNotification({
          type: 'error',
          title: 'Error',
          message: `Failed to delete prompt: ${String(e)}`,
        });
      }
    },
    [deletePrompt],
  );

  if (loading && prompts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-[var(--font-size)]">
        Loading prompts…
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-text-muted gap-2 px-6">
        <p className="text-[var(--font-size)] text-text-secondary text-center">
          {prompts.length === 0
            ? 'No prompts yet. Create reusable prompts for your agents.'
            : 'No prompts match the current filters.'}
        </p>
      </div>
    );
  }

  if (viewMode === 'grid') {
    return (
      <div className="p-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 content-start">
        {filtered.map((prompt) => (
          <PromptCard
            key={prompt.id}
            prompt={prompt}
            onInsert={onInsert}
            onEdit={() => openEditor(prompt)}
            onCopy={() => handleCopy(prompt.content)}
            onDelete={() => setPendingDeleteId(prompt.id)}
          />
        ))}
        <ConfirmDialog
          open={pendingDeleteId !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDeleteId(null);
          }}
          title="Delete prompt?"
          description={
            pendingDeleteId ? (
              <p className="text-sm text-text-secondary">
                Are you sure you want to delete{' '}
                <span className="font-medium text-text-primary">
                  {prompts.find((p) => p.id === pendingDeleteId)?.name ?? 'this prompt'}
                </span>
                ? This cannot be undone.
              </p>
            ) : null
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            if (pendingDeleteId) {
              const id = pendingDeleteId;
              void handleDelete(id);
            }
          }}
        />
      </div>
    );
  }

  // List view
  return (
    <div className="flex flex-col gap-1 p-2">
      {filtered.map((prompt) => (
        <PromptListItem
          key={prompt.id}
          prompt={prompt}
          onInsert={onInsert}
          onEdit={() => openEditor(prompt)}
          onCopy={() => handleCopy(prompt.content)}
          onDelete={() => setPendingDeleteId(prompt.id)}
        />
      ))}
      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title="Delete prompt?"
        description={
          pendingDeleteId ? (
            <p className="text-sm text-text-secondary">
              Are you sure you want to delete{' '}
              <span className="font-medium text-text-primary">
                {prompts.find((p) => p.id === pendingDeleteId)?.name ?? 'this prompt'}
              </span>
              ? This cannot be undone.
            </p>
          ) : null
        }
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (pendingDeleteId) {
            const id = pendingDeleteId;
            void handleDelete(id);
          }
        }}
      />
    </div>
  );
});

PromptListSection.displayName = 'PromptListSection';

export default PromptListSection;

// ── Card (grid) ─────────────────────────────────────────────────────────────

interface PromptCardProps {
  prompt: PromptResource;
  onInsert?: (prompt: PromptResource, target?: PromptInsertTarget) => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

const PromptCard: React.FC<PromptCardProps> = React.memo(
  ({ prompt, onInsert, onEdit, onCopy, onDelete }) => {
    const preview = prompt.content.slice(0, 120).replace(/\n/g, ' ');
    const [menuOpen, setMenuOpen] = React.useState(false);
    return (
      <div className="group relative flex flex-col rounded-lg border border-border bg-bg-primary hover:bg-bg-hover transition-colors p-3 gap-2">
        <div className="flex items-start justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            {prompt.slash && (
              <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-hover text-text-muted border border-border">
                /{prompt.slash}
              </span>
            )}
            <span className="text-[var(--font-size)] font-semibold text-text-primary truncate">
              {prompt.name}
            </span>
          </div>
          {prompt.favorite && (
            <Star className="h-3 w-3 text-accent-yellow shrink-0" fill="currentColor" />
          )}
        </div>
        {prompt.description && (
          <p className="text-[11px] text-text-muted line-clamp-2">{prompt.description}</p>
        )}
        <p className="text-[11px] text-text-muted line-clamp-3 font-mono leading-relaxed">
          {preview}
        </p>
        {prompt.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {prompt.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted border border-border"
              >
                {t}
              </span>
            ))}
            {prompt.tags.length > 3 && (
              <span className="text-[10px] text-text-muted">+{prompt.tags.length - 3}</span>
            )}
          </div>
        )}
        <div className="flex items-center gap-1 mt-auto pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex-1 flex items-center gap-0.5 relative">
            <button
              type="button"
              className="flex-1 h-7 text-[11px] font-medium rounded-l-md bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 flex items-center justify-center gap-1"
              onClick={() => onInsert?.(prompt, 'agent')}
              title="Insert to agent input"
            >
              <CornerDownLeft className="h-3 w-3" />
              Insert
            </button>
            <button
              type="button"
              className="h-7 w-6 rounded-r-md bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 flex items-center justify-center border-l border-accent-blue/20"
              onClick={() => setMenuOpen((v) => !v)}
              title="Choose insert target"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
            {menuOpen && (
              <div
                className="absolute bottom-full left-0 mb-1 w-44 rounded-md border border-border bg-bg-primary shadow-lg py-1 z-10"
                onMouseLeave={() => setMenuOpen(false)}
              >
                <button
                  type="button"
                  className="w-full text-left px-2.5 py-1.5 text-[11px] text-text-secondary hover:bg-bg-hover flex items-center gap-1.5"
                  onClick={() => {
                    setMenuOpen(false);
                    onInsert?.(prompt, 'agent');
                  }}
                >
                  <CornerDownLeft className="h-3 w-3" />
                  Insert to Agent
                </button>
                <button
                  type="button"
                  className="w-full text-left px-2.5 py-1.5 text-[11px] text-text-secondary hover:bg-bg-hover flex items-center gap-1.5"
                  onClick={() => {
                    setMenuOpen(false);
                    onInsert?.(prompt, 'terminal');
                  }}
                >
                  <Terminal className="h-3 w-3" />
                  Insert to Terminal
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="h-7 w-7 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover flex items-center justify-center"
            onClick={onCopy}
            title="Copy content"
          >
            <Copy className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="h-7 w-7 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover flex items-center justify-center"
            onClick={onEdit}
            title="Edit"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="h-7 w-7 rounded-md text-text-muted hover:text-accent-red hover:bg-bg-hover flex items-center justify-center"
            onClick={onDelete}
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  },
);

PromptCard.displayName = 'PromptCard';

// ── List item ───────────────────────────────────────────────────────────────

const PromptListItem: React.FC<PromptCardProps> = React.memo(
  ({ prompt, onInsert, onEdit, onCopy, onDelete }) => {
    const [menuOpen, setMenuOpen] = React.useState(false);
    return (
      <div className="group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md hover:bg-bg-hover transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {prompt.slash && (
              <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-hover text-text-muted border border-border">
                /{prompt.slash}
              </span>
            )}
            <span className="text-[var(--font-size)] font-medium text-text-primary truncate">
              {prompt.name}
            </span>
            {prompt.favorite && (
              <Star className="h-3 w-3 text-accent-yellow shrink-0" fill="currentColor" />
            )}
            {prompt.scope === 'project' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue border border-accent-blue/20">
                project
              </span>
            )}
          </div>
          {prompt.description && (
            <p className="text-[11px] text-text-muted truncate mt-0.5">{prompt.description}</p>
          )}
        </div>
        {prompt.tags.length > 0 && (
          <div className="hidden md:flex items-center gap-1 shrink-0">
            {prompt.tags.slice(0, 2).map((t) => (
              <span
                key={t}
                className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted border border-border"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 relative">
          <button
            type="button"
            className="h-7 px-2 text-[11px] font-medium rounded-l-md bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 flex items-center gap-1"
            onClick={() => onInsert?.(prompt, 'agent')}
            title="Insert to agent input"
          >
            <CornerDownLeft className="h-3 w-3" />
            Insert
          </button>
          <button
            type="button"
            className="h-7 w-6 rounded-r-md bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 flex items-center justify-center border-l border-accent-blue/20"
            onClick={() => setMenuOpen((v) => !v)}
            title="Choose insert target"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-full mt-1 w-44 rounded-md border border-border bg-bg-primary shadow-lg py-1 z-10"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <button
                type="button"
                className="w-full text-left px-2.5 py-1.5 text-[11px] text-text-secondary hover:bg-bg-hover flex items-center gap-1.5"
                onClick={() => {
                  setMenuOpen(false);
                  onInsert?.(prompt, 'agent');
                }}
              >
                <CornerDownLeft className="h-3 w-3" />
                Insert to Agent
              </button>
              <button
                type="button"
                className="w-full text-left px-2.5 py-1.5 text-[11px] text-text-secondary hover:bg-bg-hover flex items-center gap-1.5"
                onClick={() => {
                  setMenuOpen(false);
                  onInsert?.(prompt, 'terminal');
                }}
              >
                <Terminal className="h-3 w-3" />
                Insert to Terminal
              </button>
            </div>
          )}
          <button
            type="button"
            className="h-7 w-7 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover flex items-center justify-center"
            onClick={onCopy}
            title="Copy content"
          >
            <Copy className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="h-7 w-7 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover flex items-center justify-center"
            onClick={onEdit}
            title="Edit"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="h-7 w-7 rounded-md text-text-muted hover:text-accent-red hover:bg-bg-hover flex items-center justify-center"
            onClick={onDelete}
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  },
);

PromptListItem.displayName = 'PromptListItem';

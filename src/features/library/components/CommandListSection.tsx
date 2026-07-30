import { Copy, Pencil, Trash2 } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import { useNotificationStore } from '@/shared/store/notificationStore';
import type { PromptResource } from '@/shared/types/library';

interface CommandListSectionProps {
  /** Called when the user picks a command to edit. */
  onEdit?: (command: PromptResource) => void;
}

const CommandListSection: React.FC<CommandListSectionProps> = React.memo(({ onEdit }) => {
  const commands = useLibraryStore((s) => s.commands);
  const loading = useLibraryStore((s) => s.commandsLoading);
  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const viewMode = useLibraryStore((s) => s.viewMode);
  const sortMode = useLibraryStore((s) => s.sortMode);
  const deletePrompt = useLibraryStore((s) => s.deletePrompt);

  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = [...commands];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q) ||
          c.content.toLowerCase().includes(q) ||
          c.slash?.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q)),
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
  }, [commands, searchQuery, sortMode]);

  const handleCopy = useCallback((content: string) => {
    void navigator.clipboard.writeText(content).then(() => {
      useNotificationStore.getState().addNotification({
        type: 'info',
        title: 'Copied',
        message: 'Command copied to clipboard',
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
          message: `Failed to delete command: ${String(e)}`,
        });
      }
    },
    [deletePrompt],
  );

  if (loading && commands.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-[var(--font-size)]">
        Loading commands…
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-text-muted gap-2 px-6">
        <p className="text-[var(--font-size)] text-text-secondary text-center">
          {commands.length === 0
            ? 'No commands yet. Create slash commands that deploy to your agents.'
            : 'No commands match the current filters.'}
        </p>
      </div>
    );
  }

  if (viewMode === 'grid') {
    return (
      <div className="p-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 content-start">
        {filtered.map((command) => (
          <CommandCard
            key={command.id}
            command={command}
            onEdit={() => onEdit?.(command)}
            onCopy={() => handleCopy(command.content)}
            onDelete={() => setPendingDeleteId(command.id)}
          />
        ))}
        <ConfirmDialog
          open={pendingDeleteId !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDeleteId(null);
          }}
          title="Delete command?"
          description={
            pendingDeleteId ? (
              <p className="text-sm text-text-secondary">
                Are you sure you want to delete{' '}
                <span className="font-medium text-text-primary">
                  {commands.find((c) => c.id === pendingDeleteId)?.name ?? 'this command'}
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
      {filtered.map((command) => (
        <CommandListItem
          key={command.id}
          command={command}
          onEdit={() => onEdit?.(command)}
          onCopy={() => handleCopy(command.content)}
          onDelete={() => setPendingDeleteId(command.id)}
        />
      ))}
      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title="Delete command?"
        description={
          pendingDeleteId ? (
            <p className="text-sm text-text-secondary">
              Are you sure you want to delete{' '}
              <span className="font-medium text-text-primary">
                {commands.find((c) => c.id === pendingDeleteId)?.name ?? 'this command'}
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

CommandListSection.displayName = 'CommandListSection';

export default CommandListSection;

// ── Card (grid) ─────────────────────────────────────────────────────────────

interface CommandCardProps {
  command: PromptResource;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

const CommandCard: React.FC<CommandCardProps> = React.memo(
  ({ command, onEdit, onCopy, onDelete }) => {
    const preview = command.content.slice(0, 120).replace(/\n/g, ' ');
    return (
      <div className="group relative flex flex-col rounded-lg border border-border bg-bg-primary hover:bg-bg-hover transition-colors p-3 gap-2">
        <div className="flex items-start justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            {command.slash && (
              <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-hover text-text-muted border border-border">
                /{command.slash}
              </span>
            )}
            <span className="text-[var(--font-size)] font-semibold text-text-primary truncate">
              {command.name}
            </span>
          </div>
        </div>
        {command.description && (
          <p className="text-[11px] text-text-muted line-clamp-2">{command.description}</p>
        )}
        <p className="text-[11px] text-text-muted line-clamp-3 font-mono leading-relaxed">
          {preview}
        </p>
        {command.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {command.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted border border-border"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1 mt-auto pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            className="flex-1 h-7 text-[11px] font-medium rounded-md bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 flex items-center justify-center gap-1"
            onClick={onCopy}
            title="Copy content"
          >
            <Copy className="h-3 w-3" />
            Copy
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

CommandCard.displayName = 'CommandCard';

// ── List item ───────────────────────────────────────────────────────────────

const CommandListItem: React.FC<CommandCardProps> = React.memo(
  ({ command, onEdit, onCopy, onDelete }) => {
    return (
      <div className="group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md hover:bg-bg-hover transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {command.slash && (
              <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-hover text-text-muted border border-border">
                /{command.slash}
              </span>
            )}
            <span className="text-[var(--font-size)] font-medium text-text-primary truncate">
              {command.name}
            </span>
          </div>
          {command.description && (
            <p className="text-[11px] text-text-muted truncate mt-0.5">{command.description}</p>
          )}
        </div>
        {command.tags.length > 0 && (
          <div className="hidden md:flex items-center gap-1 shrink-0">
            {command.tags.slice(0, 2).map((t) => (
              <span
                key={t}
                className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted border border-border"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            type="button"
            className="h-7 px-2 text-[11px] font-medium rounded-md bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 flex items-center gap-1"
            onClick={onCopy}
            title="Copy content"
          >
            <Copy className="h-3 w-3" />
            Copy
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

CommandListItem.displayName = 'CommandListItem';

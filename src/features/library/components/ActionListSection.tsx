import { Pencil, Play, Trash2, Zap } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import { useNotificationStore } from '@/shared/store/notificationStore';
import type { ActionResource } from '@/shared/types/library';

interface ActionListSectionProps {
  /** Called when the user picks an action to run. */
  onRun?: (action: ActionResource) => void;
  /** Called when the user picks an action to edit. */
  onEdit?: (action: ActionResource) => void;
}

const ActionListSection: React.FC<ActionListSectionProps> = React.memo(({ onRun, onEdit }) => {
  const actions = useLibraryStore((s) => s.actions);
  const loading = useLibraryStore((s) => s.actionsLoading);
  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const viewMode = useLibraryStore((s) => s.viewMode);
  const sortMode = useLibraryStore((s) => s.sortMode);
  const deleteAction = useLibraryStore((s) => s.deleteAction);

  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = actions;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.description?.toLowerCase().includes(q) ||
          a.group.toLowerCase().includes(q) ||
          a.tags.some((t) => t.toLowerCase().includes(q)),
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
  }, [actions, searchQuery, sortMode]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteAction(id);
        setPendingDeleteId(null);
      } catch (e) {
        useNotificationStore.getState().addNotification({
          type: 'error',
          title: 'Error',
          message: `Failed to delete action: ${String(e)}`,
        });
      }
    },
    [deleteAction],
  );

  if (loading && actions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-[var(--font-size)]">
        Loading actions…
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-text-muted gap-2 px-6">
        <Zap className="h-8 w-8 opacity-30" />
        <p className="text-[var(--font-size)] text-text-secondary text-center">
          {actions.length === 0
            ? 'No actions yet. Create reusable action templates.'
            : 'No actions match the current filters.'}
        </p>
      </div>
    );
  }

  if (viewMode === 'grid') {
    return (
      <div className="p-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 content-start">
        {filtered.map((action) => (
          <ActionCard
            key={action.id}
            action={action}
            onRun={() => onRun?.(action)}
            onEdit={() => onEdit?.(action)}
            onDelete={() => setPendingDeleteId(action.id)}
          />
        ))}
        <ConfirmDialog
          open={pendingDeleteId !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDeleteId(null);
          }}
          title="Delete action?"
          description={
            pendingDeleteId ? (
              <p className="text-sm text-text-secondary">
                Are you sure you want to delete{' '}
                <span className="font-medium text-text-primary">
                  {actions.find((a) => a.id === pendingDeleteId)?.name ?? 'this action'}
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
      {filtered.map((action) => (
        <ActionListItem
          key={action.id}
          action={action}
          onRun={() => onRun?.(action)}
          onEdit={() => onEdit?.(action)}
          onDelete={() => setPendingDeleteId(action.id)}
        />
      ))}
      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title="Delete action?"
        description={
          pendingDeleteId ? (
            <p className="text-sm text-text-secondary">
              Are you sure you want to delete{' '}
              <span className="font-medium text-text-primary">
                {actions.find((a) => a.id === pendingDeleteId)?.name ?? 'this action'}
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

ActionListSection.displayName = 'ActionListSection';

export default ActionListSection;

// ── Card (grid) ─────────────────────────────────────────────────────────────

interface ActionCardProps {
  action: ActionResource;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const ActionCard: React.FC<ActionCardProps> = React.memo(({ action, onRun, onEdit, onDelete }) => {
  const payloadLabel =
    action.payload.type === 'insert-prompt'
      ? 'Insert Prompt'
      : action.payload.type === 'run-command'
        ? 'Run Command'
        : action.payload.type === 'open-panel'
          ? 'Open Panel'
          : 'Run Skill';

  return (
    <div className="group relative flex flex-col rounded-lg border border-border bg-bg-primary hover:bg-bg-hover transition-colors p-3 gap-2">
      <div className="flex items-start justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Zap className="h-3 w-3 text-accent-yellow shrink-0" />
          <span className="text-[var(--font-size)] font-semibold text-text-primary truncate">
            {action.name}
          </span>
        </div>
      </div>
      {action.description && (
        <p className="text-[11px] text-text-muted line-clamp-2">{action.description}</p>
      )}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted border border-border">
          {action.group}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue border border-accent-blue/20">
          {payloadLabel}
        </span>
      </div>
      {action.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {action.tags.slice(0, 3).map((t) => (
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
          onClick={onRun}
          title="Run action"
        >
          <Play className="h-3 w-3" />
          Run
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
});

ActionCard.displayName = 'ActionCard';

// ── List item ───────────────────────────────────────────────────────────────

const ActionListItem: React.FC<ActionCardProps> = React.memo(
  ({ action, onRun, onEdit, onDelete }) => {
    const payloadLabel =
      action.payload.type === 'insert-prompt'
        ? 'Insert Prompt'
        : action.payload.type === 'run-command'
          ? 'Run Command'
          : action.payload.type === 'open-panel'
            ? 'Open Panel'
            : 'Run Skill';

    return (
      <div className="group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md hover:bg-bg-hover transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Zap className="h-3 w-3 text-accent-yellow shrink-0" />
            <span className="text-[var(--font-size)] font-medium text-text-primary truncate">
              {action.name}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted border border-border">
              {action.group}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue border border-accent-blue/20">
              {payloadLabel}
            </span>
          </div>
          {action.description && (
            <p className="text-[11px] text-text-muted truncate mt-0.5">{action.description}</p>
          )}
        </div>
        {action.tags.length > 0 && (
          <div className="hidden md:flex items-center gap-1 shrink-0">
            {action.tags.slice(0, 2).map((t) => (
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
            onClick={onRun}
            title="Run action"
          >
            <Play className="h-3 w-3" />
            Run
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

ActionListItem.displayName = 'ActionListItem';

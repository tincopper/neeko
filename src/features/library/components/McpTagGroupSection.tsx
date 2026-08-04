import {
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import { useMcpStore } from '@/features/library/store/mcpStore';
import { cn } from '@/lib/utils';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import { useNotificationStore } from '@/shared/store/notificationStore';

import McpTagGroupDialog from './McpTagGroupDialog';

/**
 * Left sidebar section showing MCP tag groups.
 * Mirrors the SkillsPanel tag group section pattern.
 */
const McpTagGroupSection: React.FC = React.memo(() => {
  const mcpTagGroups = useMcpStore((s) => s.mcpTagGroups);
  const mcpTagGroupsLoading = useMcpStore((s) => s.mcpTagGroupsLoading);
  const activeMcpTagGroup = useMcpStore((s) => s.activeMcpTagGroup);
  const setActiveMcpTagGroup = useMcpStore((s) => s.setActiveMcpTagGroup);
  const refreshMcpTagGroups = useMcpStore((s) => s.refreshMcpTagGroups);
  const createMcpTagGroup = useMcpStore((s) => s.createMcpTagGroup);
  const deleteMcpTagGroup = useMcpStore((s) => s.deleteMcpTagGroup);
  const updateMcpTagGroup = useMcpStore((s) => s.updateMcpTagGroup);

  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<{
    id: string;
    name: string;
    description?: string | null;
    icon?: string | null;
  } | null>(null);

  const toast = useCallback((message: string, type: 'info' | 'error' = 'info') => {
    useNotificationStore.getState().addNotification({
      type: type === 'error' ? 'error' : 'info',
      title: type === 'error' ? 'Error' : 'MCP Tags',
      message,
    });
  }, []);

  useEffect(() => {
    void refreshMcpTagGroups();
  }, [refreshMcpTagGroups]);

  const handleTagGroupSelect = useCallback(
    (id: string) => {
      setActiveMcpTagGroup(activeMcpTagGroup === id ? null : id);
    },
    [activeMcpTagGroup, setActiveMcpTagGroup],
  );

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await createMcpTagGroup({ name, description: null, icon: null });
      setNewName('');
      setCreating(false);
      toast(`Created MCP tag group "${name}"`);
    } catch (e) {
      toast(String(e), 'error');
    }
  }, [newName, createMcpTagGroup, toast]);

  const deleteTagGroupById = useCallback(
    async (id: string) => {
      try {
        const tag = mcpTagGroups.find((t) => t.id === id);
        await deleteMcpTagGroup(id);
        if (activeMcpTagGroup === id) {
          setActiveMcpTagGroup(null);
        }
        toast(`Deleted tag group "${tag?.name ?? id}"`);
      } catch (err) {
        toast(String(err), 'error');
      }
    },
    [mcpTagGroups, deleteMcpTagGroup, activeMcpTagGroup, setActiveMcpTagGroup, toast],
  );

  const handleDelete = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setPendingDeleteId(id);
  }, []);

  const handleRenameStart = useCallback((e: React.MouseEvent, id: string, currentName: string) => {
    e.stopPropagation();
    setRenamingId(id);
    setRenameValue(currentName);
  }, []);

  const handleRenameSubmit = useCallback(
    async (id: string) => {
      const name = renameValue.trim();
      if (!name || name === mcpTagGroups.find((t) => t.id === id)?.name) {
        setRenamingId(null);
        return;
      }
      try {
        await updateMcpTagGroup(id, { name });
        setRenamingId(null);
        toast(`Renamed to "${name}"`);
      } catch (err) {
        toast(String(err), 'error');
      }
    },
    [renameValue, mcpTagGroups, updateMcpTagGroup, toast],
  );

  const handleOpenEditDialog = useCallback(
    (
      e: React.MouseEvent,
      tg: { id: string; name: string; description?: string | null; icon?: string | null },
    ) => {
      e.stopPropagation();
      setEditingTag(tg);
      setDialogOpen(true);
    },
    [],
  );

  const handleDialogClose = useCallback(() => {
    setDialogOpen(false);
    setEditingTag(null);
  }, []);

  return (
    <div className="border-t border-border mt-0.5 pt-1">
      <div className="flex items-center gap-1 px-3 py-1.5 select-none">
        <button
          type="button"
          className="flex items-center gap-1 flex-1 min-w-0 text-left"
          onClick={() => setTagsExpanded((v) => !v)}
        >
          {tagsExpanded ? (
            <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
          )}
          <span className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-text-muted">
            Tags
          </span>
          {mcpTagGroupsLoading && (
            <RefreshCw className="h-2.5 w-2.5 text-text-muted animate-spin ml-1" />
          )}
        </button>
        <button
          type="button"
          className="p-1 rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
          title="New tag group"
          onClick={() => {
            setEditingTag(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {tagsExpanded && (
        <div className="pb-2 px-1.5">
          {creating && (
            <div className="px-1.5 py-1 flex gap-1 items-center mb-0.5">
              <input
                className={cn(
                  'flex-1 min-w-0 h-7 px-2 text-[var(--font-size)] rounded-md',
                  'bg-bg-hover/60 border border-border text-text-primary',
                  'outline-none focus:border-border focus:bg-bg-primary placeholder:text-text-muted',
                )}
                placeholder="e.g. Backend"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate();
                  if (e.key === 'Escape') {
                    setCreating(false);
                    setNewName('');
                  }
                }}
              />
              <button
                type="button"
                className="h-7 px-2.5 text-[11px] font-medium text-text-primary bg-bg-selected hover:bg-bg-hover rounded-md shrink-0 border border-border"
                onClick={() => void handleCreate()}
              >
                Add
              </button>
            </div>
          )}

          {mcpTagGroups.map((tg) => {
            const active = activeMcpTagGroup === tg.id;
            return (
              <div
                key={tg.id}
                role="button"
                tabIndex={0}
                className={cn(
                  'group/row flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors duration-150',
                  'text-[var(--font-size)]',
                  active
                    ? 'bg-bg-selected text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                )}
                onClick={() => handleTagGroupSelect(tg.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleTagGroupSelect(tg.id);
                  }
                }}
              >
                <LayoutGrid className="h-3.5 w-3.5 shrink-0 opacity-50" />
                {renamingId === tg.id ? (
                  <input
                    className={cn(
                      'flex-1 min-w-0 h-6 px-1.5 text-[var(--font-size)] rounded',
                      'bg-bg-hover/60 border border-border text-text-primary outline-none',
                    )}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleRenameSubmit(tg.id);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onBlur={() => void handleRenameSubmit(tg.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="truncate flex-1 font-medium">{tg.name}</span>
                )}
                <span className="text-[11px] tabular-nums text-text-muted min-w-[1.25rem] text-right">
                  {tg.serverCount}
                </span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity w-0 group-hover/row:w-auto overflow-hidden group-hover/row:overflow-visible">
                  <button
                    type="button"
                    onClick={(e) => void handleRenameStart(e, tg.id, tg.name)}
                    className="p-0.5 rounded text-text-muted hover:text-text-primary"
                    title="Rename tag"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => void handleOpenEditDialog(e, tg)}
                    className="p-0.5 rounded text-text-muted hover:text-text-primary"
                    title="Edit tag details"
                  >
                    <LayoutGrid className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => void handleDelete(e, tg.id)}
                    className="p-0.5 rounded text-text-muted hover:text-accent-red"
                    title="Delete tag"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}

          {!creating && mcpTagGroups.length > 0 && (
            <button
              type="button"
              className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-[var(--font-size)] text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-colors"
              onClick={() => {
                setEditingTag(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              New Tag
            </button>
          )}

          {mcpTagGroups.length === 0 && !creating && (
            <p className="px-2.5 py-1 text-[11px] text-text-muted leading-relaxed">
              Group MCP servers by role (Backend, Frontend…)
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title="Delete MCP tag group?"
        description={
          pendingDeleteId ? (
            <p className="text-sm text-text-secondary">
              Are you sure you want to delete{' '}
              <span className="font-medium text-text-primary">
                {mcpTagGroups.find((t) => t.id === pendingDeleteId)?.name ?? 'this tag group'}
              </span>
              ? All server associations will be removed.
            </p>
          ) : null
        }
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (pendingDeleteId) {
            const id = pendingDeleteId;
            setPendingDeleteId(null);
            void deleteTagGroupById(id);
          }
        }}
      />

      <McpTagGroupDialog open={dialogOpen} tagGroup={editingTag} onClose={handleDialogClose} />
    </div>
  );
});

McpTagGroupSection.displayName = 'McpTagGroupSection';

export default McpTagGroupSection;

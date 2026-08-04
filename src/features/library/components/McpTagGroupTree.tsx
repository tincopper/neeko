import { ChevronDown, ChevronRight, LayoutGrid, Pencil, Plus, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useMcpStore } from '@/features/library/store/mcpStore';
import { cn } from '@/lib/utils';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import { useNotify } from '@/shared/hooks/useNotify';

/** Tag group tree inside the MCP navigation panel (create / rename / delete / filter). */
const McpTagGroupTree: React.FC = React.memo(() => {
  const mcpTagGroups = useMcpStore((s) => s.mcpTagGroups);
  const activeMcpTagGroup = useMcpStore((s) => s.activeMcpTagGroup);
  const setActiveMcpTagGroup = useMcpStore((s) => s.setActiveMcpTagGroup);
  const setMcpView = useMcpStore((s) => s.setMcpView);
  const createMcpTagGroup = useMcpStore((s) => s.createMcpTagGroup);
  const updateMcpTagGroup = useMcpStore((s) => s.updateMcpTagGroup);
  const deleteMcpTagGroup = useMcpStore((s) => s.deleteMcpTagGroup);

  const [expanded, setExpanded] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { notify } = useNotify();

  // Auto-focus the input when create/rename mode is activated.
  useEffect(() => {
    if (creating) createInputRef.current?.focus();
  }, [creating]);
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const handleSelect = useCallback(
    (id: string) => {
      setActiveMcpTagGroup(activeMcpTagGroup === id ? null : id);
      setMcpView('installed');
    },
    [activeMcpTagGroup, setActiveMcpTagGroup, setMcpView],
  );

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await createMcpTagGroup({ name });
      setCreating(false);
      setNewName('');
    } catch (e) {
      notify(`Failed to create tag group: ${String(e)}`, 'error');
    }
  }, [newName, createMcpTagGroup, notify]);

  const handleRename = useCallback(
    async (id: string) => {
      const name = renameValue.trim();
      if (!name) return;
      try {
        await updateMcpTagGroup(id, { name });
        setRenamingId(null);
        setRenameValue('');
      } catch (e) {
        notify(`Failed to rename tag group: ${String(e)}`, 'error');
      }
    },
    [renameValue, updateMcpTagGroup, notify],
  );

  const handleDelete = useCallback(async () => {
    if (!pendingDeleteId) return;
    try {
      await deleteMcpTagGroup(pendingDeleteId);
      if (activeMcpTagGroup === pendingDeleteId) {
        setActiveMcpTagGroup(null);
      }
      setPendingDeleteId(null);
    } catch (e) {
      notify(`Failed to delete tag group: ${String(e)}`, 'error');
    }
  }, [pendingDeleteId, deleteMcpTagGroup, activeMcpTagGroup, setActiveMcpTagGroup, notify]);

  return (
    <div className="border-t border-border mt-0.5 pt-1">
      <div className="flex items-center gap-1 px-3 py-1.5 select-none">
        <button
          type="button"
          className="flex items-center gap-1 flex-1 min-w-0 text-left"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
          )}
          <span className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-text-muted">
            Tags
          </span>
        </button>
        <button
          type="button"
          className="p-1 rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
          title="New tag group"
          onClick={() => setCreating(true)}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {expanded && (
        <div className="pb-2 px-1.5">
          {creating && (
            <div className="px-2.5 py-1.5">
              <input
                ref={createInputRef}
                className={cn(
                  'w-full h-7 px-2 text-[var(--font-size)] rounded-md',
                  'bg-bg-primary border border-border text-text-primary',
                  'outline-none focus:border-accent-blue',
                )}
                placeholder="Tag group name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate();
                  if (e.key === 'Escape') {
                    setCreating(false);
                    setNewName('');
                  }
                }}
                onBlur={() => {
                  if (!newName.trim()) {
                    setCreating(false);
                    setNewName('');
                  }
                }}
              />
            </div>
          )}
          {mcpTagGroups.length === 0 && !creating && (
            <p className="px-2.5 py-2 text-[11px] text-text-muted leading-snug">
              Group servers by role (Backend, Frontend...)
            </p>
          )}
          {mcpTagGroups.map((group) => (
            <div
              key={group.id}
              role="button"
              tabIndex={0}
              className={cn(
                'group/row flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors duration-150',
                activeMcpTagGroup === group.id
                  ? 'bg-bg-selected text-text-primary'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
              )}
              onClick={() => handleSelect(group.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSelect(group.id);
              }}
            >
              <LayoutGrid className="h-3.5 w-3.5 shrink-0 opacity-50" />
              {renamingId === group.id ? (
                <input
                  ref={renameInputRef}
                  className={cn(
                    'flex-1 h-6 px-1.5 text-[var(--font-size)] rounded',
                    'bg-bg-primary border border-border text-text-primary',
                    'outline-none focus:border-accent-blue',
                  )}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRename(group.id);
                    if (e.key === 'Escape') {
                      setRenamingId(null);
                      setRenameValue('');
                    }
                  }}
                  onBlur={() => {
                    if (renameValue.trim() && renameValue.trim() !== group.name) {
                      void handleRename(group.id);
                    } else {
                      setRenamingId(null);
                      setRenameValue('');
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="truncate flex-1 font-medium">{group.name}</span>
              )}
              <span className="text-[11px] tabular-nums text-text-muted min-w-[1.25rem] text-right">
                {group.serverCount}
              </span>
              <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity w-0 group-hover/row:w-auto overflow-hidden group-hover/row:overflow-visible">
                <button
                  type="button"
                  className="p-0.5 rounded text-text-muted hover:text-text-primary"
                  title="Rename tag"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenamingId(group.id);
                    setRenameValue(group.name);
                  }}
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="p-0.5 rounded text-text-muted hover:text-accent-red"
                  title="Delete tag"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDeleteId(group.id);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
          {mcpTagGroups.length > 0 && !creating && (
            <button
              type="button"
              className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-[var(--font-size)] text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-colors"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              New Tag
            </button>
          )}
        </div>
      )}

      {pendingDeleteId && (
        <ConfirmDialog
          open
          onOpenChange={(v) => {
            if (!v) setPendingDeleteId(null);
          }}
          title="Delete Tag Group"
          description="Are you sure you want to delete this tag group? Servers in the group will not be deleted."
          confirmLabel="Delete"
          danger
          onConfirm={() => void handleDelete()}
        />
      )}
    </div>
  );
});

McpTagGroupTree.displayName = 'McpTagGroupTree';

export default McpTagGroupTree;

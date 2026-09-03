import { LayoutGrid, Pencil, Plus, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useMcpStore } from '@/features/library/store/mcpStore';
import { cn } from '@/lib/utils';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import CountLabel from '@/shared/components/nav/CountLabel';
import NavEmpty from '@/shared/components/nav/NavEmpty';
import NavRow from '@/shared/components/nav/NavRow';
import NavSection from '@/shared/components/nav/NavSection';
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
    <NavSection
      title="Tags"
      defaultExpanded
      listClassName="pb-2 px-1.5"
      actions={
        <button
          type="button"
          className="p-1 rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
          title="New tag group"
          onClick={() => setCreating(true)}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      }
    >
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
        <NavEmpty className="py-2 leading-snug">
          Group servers by role (Backend, Frontend...)
        </NavEmpty>
      )}
      {mcpTagGroups.map((group) => (
        <NavRow
          key={group.id}
          active={activeMcpTagGroup === group.id}
          onSelect={() => handleSelect(group.id)}
          leading={<LayoutGrid className="h-3.5 w-3.5 shrink-0 opacity-50" />}
          actions={
            <>
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
            </>
          }
        >
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
          <CountLabel loading={false} count={group.serverCount} />
        </NavRow>
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
    </NavSection>
  );
});

McpTagGroupTree.displayName = 'McpTagGroupTree';

export default McpTagGroupTree;

import { Loader2, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useMcpStore } from '@/features/library/store/mcpStore';
import { cn } from '@/lib/utils';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui';

interface McpTagGroupDialogProps {
  open: boolean;
  tagGroup: {
    id: string;
    name: string;
    description?: string | null;
    icon?: string | null;
  } | null;
  onClose: () => void;
}

/**
 * Dialog for creating or editing an MCP tag group.
 * Mirrors the AssignTagGroupDialog pattern.
 */

/** Delay before focusing the name input — lets the dialog finish mounting. */
const FOCUS_DELAY_MS = 50;
const McpTagGroupDialog: React.FC<McpTagGroupDialogProps> = React.memo(
  ({ open, tagGroup, onClose }) => {
    const createMcpTagGroup = useMcpStore((s) => s.createMcpTagGroup);
    const updateMcpTagGroup = useMcpStore((s) => s.updateMcpTagGroup);
    const isEditing = tagGroup !== null;

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [icon, setIcon] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);

    // Reset form when dialog opens
    useEffect(() => {
      if (open) {
        setName(tagGroup?.name ?? '');
        setDescription(tagGroup?.description ?? '');
        setIcon(tagGroup?.icon ?? '');
        setSaving(false);
        setError(null);
      }
    }, [open, tagGroup]);

    // Auto-focus name input on open
    useEffect(() => {
      if (open) {
        const timer = setTimeout(() => {
          nameInputRef.current?.focus();
        }, FOCUS_DELAY_MS);
        return () => clearTimeout(timer);
      }
    }, [open]);

    const handleSave = useCallback(async () => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        setError('Name is required');
        return;
      }
      setSaving(true);
      setError(null);
      try {
        if (tagGroup?.id) {
          await updateMcpTagGroup(tagGroup.id, {
            name: trimmedName,
            description: description.trim() || null,
            icon: icon.trim() || null,
          });
        } else {
          await createMcpTagGroup({
            name: trimmedName,
            description: description.trim() || null,
            icon: icon.trim() || null,
          });
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setSaving(false);
      }
    }, [name, description, icon, tagGroup, createMcpTagGroup, updateMcpTagGroup]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          void handleSave();
        } else if (e.key === 'Escape') {
          onClose();
        }
      },
      [handleSave, onClose],
    );

    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-[400px] p-0 gap-0" showCloseButton={false}>
          {/* ── Header ── */}
          <DialogHeader className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xs font-semibold text-text-primary">
                {isEditing ? 'Edit tag group' : 'New tag group'}
              </DialogTitle>
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
                aria-label="Close dialog"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </DialogHeader>

          {/* ── Body ── */}
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- keyboard handler on container */}
          <div className="px-4 py-3 space-y-3" onKeyDown={handleKeyDown}>
            {error && (
              <div className="text-[11px] text-accent-red bg-accent-red/10 border border-accent-red/20 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            {/* Name */}
            <div className="space-y-1.5">
              <label htmlFor="mcp-tag-name" className="text-[11px] font-medium text-text-secondary">
                Name <span className="text-accent-red">*</span>
              </label>
              <input
                ref={nameInputRef}
                id="mcp-tag-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Backend Tools"
                disabled={saving}
                className={cn(
                  'w-full h-8 px-2.5 text-xs rounded-md',
                  'bg-bg-hover/50 border border-border/80',
                  'text-text-primary placeholder:text-text-muted',
                  'outline-none focus:border-border focus:bg-bg-primary transition-colors',
                  'disabled:opacity-50',
                )}
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label
                htmlFor="mcp-tag-description"
                className="text-[11px] font-medium text-text-secondary"
              >
                Description
              </label>
              <input
                id="mcp-tag-description"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                disabled={saving}
                className={cn(
                  'w-full h-8 px-2.5 text-xs rounded-md',
                  'bg-bg-hover/50 border border-border/80',
                  'text-text-primary placeholder:text-text-muted',
                  'outline-none focus:border-border focus:bg-bg-primary transition-colors',
                  'disabled:opacity-50',
                )}
              />
            </div>

            {/* Icon (emoji or icon name) */}
            <div className="space-y-1.5">
              <label htmlFor="mcp-tag-icon" className="text-[11px] font-medium text-text-secondary">
                Icon
              </label>
              <input
                id="mcp-tag-icon"
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="Optional icon (emoji or name)"
                disabled={saving}
                className={cn(
                  'w-full h-8 px-2.5 text-xs rounded-md',
                  'bg-bg-hover/50 border border-border/80',
                  'text-text-primary placeholder:text-text-muted',
                  'outline-none focus:border-border focus:bg-bg-primary transition-colors',
                  'disabled:opacity-50',
                )}
              />
            </div>
          </div>

          {/* ── Footer ── */}
          <DialogFooter className="px-4 py-2.5 border-t border-border flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="flex-1 gap-1.5"
              disabled={saving || !name.trim()}
              onClick={() => void handleSave()}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {isEditing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);
McpTagGroupDialog.displayName = 'McpTagGroupDialog';

export default McpTagGroupDialog;

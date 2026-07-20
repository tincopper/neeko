import React, { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/ui';
import { ResizablePanel } from '@/ui/ResizablePanel';
import { cn } from '@/lib/utils';
import type { TagGroup } from '@/shared/types';

interface AssignTagGroupDialogProps {
  open: boolean;
  skillName: string;
  skillId: string;
  tagGroups: TagGroup[];
  onClose: () => void;
  onAssign: (skillId: string, tagGroupId: string) => Promise<void>;
  onSkip: () => void;
}

/**
 * Post-install prompt: optionally add a newly installed skill to a tag group.
 */
const AssignTagGroupDialog: React.FC<AssignTagGroupDialogProps> = React.memo(
  ({ open, skillName, skillId, tagGroups, onClose, onAssign, onSkip }) => {
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handlePick = useCallback(
      async (tagGroupId: string) => {
        setBusyId(tagGroupId);
        setError(null);
        try {
          await onAssign(skillId, tagGroupId);
          onClose();
        } catch (e) {
          setError(String(e));
        } finally {
          setBusyId(null);
        }
      },
      [skillId, onAssign, onClose],
    );

    if (!open) return null;

    return (
      <ResizablePanel open={open} onClose={onClose} defaultWidth={420}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold text-text-primary">Add to tag group</span>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <p className="text-xs text-text-secondary">
            <span className="font-medium text-text-primary">{skillName}</span> installed. Add it to
            a tag group so projects can load it automatically?
          </p>

          {error && (
            <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
              {error}
            </div>
          )}

          {tagGroups.length === 0 ? (
            <p className="text-xs text-text-muted">
              No tag groups yet. Create one in the Skills sidebar, then use the skill card menu.
            </p>
          ) : (
            <ul className="space-y-1 max-h-56 overflow-y-auto">
              {tagGroups.map(tg => (
                <li key={tg.id}>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void handlePick(tg.id)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded border border-border text-xs',
                      'hover:bg-accent/15 hover:border-accent text-text-primary transition-colors',
                      busyId === tg.id && 'opacity-60',
                    )}
                  >
                    <span className="mr-1.5">{tg.icon ?? '📋'}</span>
                    {tg.name}
                    <span className="text-text-muted ml-1">({tg.skill_count})</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <Button variant="ghost" size="sm" onClick={onSkip}>
            Skip
          </Button>
        </div>
      </ResizablePanel>
    );
  },
);

AssignTagGroupDialog.displayName = 'AssignTagGroupDialog';
export default AssignTagGroupDialog;

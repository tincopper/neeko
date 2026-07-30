import { X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import { cn } from '@/lib/utils';
import type { ActionResource } from '@/shared/types/library';
import { Button } from '@/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/Dialog';

interface FormState {
  name: string;
  description: string;
  group: string;
  payloadType: 'insert-prompt' | 'run-command' | 'open-panel' | 'run-skill';
  promptId: string;
  command: string;
  panelId: string;
  shortcut: string;
  tags: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  group: 'custom',
  payloadType: 'run-command',
  promptId: '',
  command: '',
  panelId: '',
  shortcut: '',
  tags: '',
};

const GROUPS = ['terminal', 'agent', 'file', 'git', 'quick', 'custom'] as const;

function parseTags(input: string): string[] {
  return input
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function buildPayload(type: FormState['payloadType'], form: FormState): ActionResource['payload'] {
  switch (type) {
    case 'insert-prompt':
      return { type: 'insert-prompt', promptId: form.promptId };
    case 'run-command':
      return { type: 'run-command', command: form.command };
    case 'open-panel':
      return { type: 'open-panel', panelId: form.panelId };
    case 'run-skill':
      return { type: 'run-skill', skillId: '' };
  }
}

const ActionEditorDialog: React.FC = React.memo(() => {
  const open = useLibraryStore((s) => s.editorOpen);
  const editing = useLibraryStore((s) => s.editingAction);
  const closeEditor = useLibraryStore((s) => s.closeEditor);
  const createAction = useLibraryStore((s) => s.createAction);
  const updateAction = useLibraryStore((s) => s.updateAction);
  const refreshActions = useLibraryStore((s) => s.refreshActions);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const payload = editing.payload;
      setForm({
        name: editing.name,
        description: editing.description ?? '',
        group: editing.group,
        payloadType: payload.type,
        promptId: payload.type === 'insert-prompt' ? payload.promptId : '',
        command: payload.type === 'run-command' ? payload.command : '',
        panelId: payload.type === 'open-panel' ? payload.panelId : '',
        shortcut: editing.shortcut ?? '',
        tags: editing.tags.join(', '),
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setError(null);
  }, [open, editing]);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    const name = form.name.trim();
    if (!name) {
      setError('Name is required');
      return;
    }
    if (form.payloadType === 'insert-prompt' && !form.promptId.trim()) {
      setError('Prompt ID is required for insert-prompt actions');
      return;
    }
    if (form.payloadType === 'run-command' && !form.command.trim()) {
      setError('Command is required for run-command actions');
      return;
    }
    if (form.payloadType === 'open-panel' && !form.panelId.trim()) {
      setError('Panel ID is required for open-panel actions');
      return;
    }

    const payload = buildPayload(form.payloadType, form);
    const tags = parseTags(form.tags);
    const group = form.group;

    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateAction(editing.id, {
          name,
          description: form.description.trim() || null,
          group,
          payload,
          shortcut: form.shortcut.trim() || null,
          tags,
          enabled: editing.enabled,
        });
      } else {
        await createAction({
          name,
          description: form.description.trim() || null,
          group,
          payload,
          shortcut: form.shortcut.trim() || null,
          tags,
        });
      }
      await refreshActions();
      closeEditor();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [form, editing, closeEditor, createAction, updateAction, refreshActions]);

  const handleClose = useCallback(() => {
    closeEditor();
  }, [closeEditor]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-[640px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b border-border">
          <DialogTitle className="text-sm font-semibold">
            {editing ? 'Edit Action' : 'New Action'}
          </DialogTitle>
          <button
            type="button"
            className="absolute right-3 top-3 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover"
            onClick={handleClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        <div className="px-4 py-3 space-y-3 max-h-[60vh] overflow-y-auto">
          {/* Name */}
          <div>
            <label
              htmlFor="action-name"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Name
            </label>
            <input
              id="action-name"
              className={cn(
                'w-full h-8 px-2.5 text-[var(--font-size)] rounded-md',
                'bg-bg-primary border border-border text-text-primary',
                'outline-none focus:border-accent-blue placeholder:text-text-muted',
              )}
              placeholder="e.g. Deploy to Staging"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
            />
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="action-description"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Description
            </label>
            <input
              id="action-description"
              className={cn(
                'w-full h-8 px-2.5 text-[var(--font-size)] rounded-md',
                'bg-bg-primary border border-border text-text-primary',
                'outline-none focus:border-accent-blue placeholder:text-text-muted',
              )}
              placeholder="Short summary (optional)"
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
            />
          </div>

          {/* Group */}
          <div>
            <span
              id="action-group-label"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Group
            </span>
            <div
              role="radiogroup"
              aria-labelledby="action-group-label"
              className="flex flex-wrap gap-2"
            >
              {GROUPS.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={cn(
                    'h-8 px-3 text-[var(--font-size)] rounded-md border transition-colors',
                    form.group === g
                      ? 'bg-bg-selected text-text-primary border-accent-blue'
                      : 'bg-bg-primary text-text-secondary border-border hover:bg-bg-hover',
                  )}
                  onClick={() => update('group', g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          {/* Payload type */}
          <div>
            <span
              id="action-payload-label"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Action Type
            </span>
            <div
              role="radiogroup"
              aria-labelledby="action-payload-label"
              className="flex flex-wrap gap-2"
            >
              {(
                [
                  { value: 'run-command', label: 'Run Command' },
                  { value: 'insert-prompt', label: 'Insert Prompt' },
                  { value: 'open-panel', label: 'Open Panel' },
                  { value: 'run-skill', label: 'Run Skill (future)' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={cn(
                    'h-8 px-3 text-[var(--font-size)] rounded-md border transition-colors',
                    form.payloadType === opt.value
                      ? 'bg-bg-selected text-text-primary border-accent-blue'
                      : 'bg-bg-primary text-text-secondary border-border hover:bg-bg-hover',
                  )}
                  onClick={() => update('payloadType', opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Type-specific fields */}
          {form.payloadType === 'insert-prompt' && (
            <div>
              <label
                htmlFor="action-prompt-id"
                className="block text-[11px] font-medium text-text-muted mb-1"
              >
                Prompt ID
              </label>
              <input
                id="action-prompt-id"
                className={cn(
                  'w-full h-8 px-2.5 text-[var(--font-size)] rounded-md',
                  'bg-bg-primary border border-border text-text-primary',
                  'outline-none focus:border-accent-blue placeholder:text-text-muted',
                )}
                placeholder="Prompt UUID"
                value={form.promptId}
                onChange={(e) => update('promptId', e.target.value)}
              />
            </div>
          )}

          {form.payloadType === 'run-command' && (
            <div>
              <label
                htmlFor="action-command"
                className="block text-[11px] font-medium text-text-muted mb-1"
              >
                Command
              </label>
              <textarea
                id="action-command"
                className={cn(
                  'w-full min-h-[80px] px-2.5 py-2 text-[var(--font-size)] rounded-md resize-y font-mono',
                  'bg-bg-primary border border-border text-text-primary',
                  'outline-none focus:border-accent-blue placeholder:text-text-muted',
                )}
                placeholder="npm run deploy"
                value={form.command}
                onChange={(e) => update('command', e.target.value)}
              />
            </div>
          )}

          {form.payloadType === 'open-panel' && (
            <div>
              <label
                htmlFor="action-panel-id"
                className="block text-[11px] font-medium text-text-muted mb-1"
              >
                Panel ID
              </label>
              <input
                id="action-panel-id"
                className={cn(
                  'w-full h-8 px-2.5 text-[var(--font-size)] rounded-md',
                  'bg-bg-primary border border-border text-text-primary',
                  'outline-none focus:border-accent-blue placeholder:text-text-muted',
                )}
                placeholder="e.g. projects, library, browser"
                value={form.panelId}
                onChange={(e) => update('panelId', e.target.value)}
              />
            </div>
          )}

          {/* Shortcut */}
          <div>
            <label
              htmlFor="action-shortcut"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Shortcut
            </label>
            <input
              id="action-shortcut"
              className={cn(
                'w-full h-8 px-2.5 text-[var(--font-size)] rounded-md',
                'bg-bg-primary border border-border text-text-primary',
                'outline-none focus:border-accent-blue placeholder:text-text-muted',
              )}
              placeholder="Optional keyboard shortcut (e.g. Ctrl+Shift+D)"
              value={form.shortcut}
              onChange={(e) => update('shortcut', e.target.value)}
            />
          </div>

          {/* Tags */}
          <div>
            <label
              htmlFor="action-tags"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Tags
            </label>
            <input
              id="action-tags"
              className={cn(
                'w-full h-8 px-2.5 text-[var(--font-size)] rounded-md',
                'bg-bg-primary border border-border text-text-primary',
                'outline-none focus:border-accent-blue placeholder:text-text-muted',
              )}
              placeholder="deploy, ci, backend  (comma separated)"
              value={form.tags}
              onChange={(e) => update('tags', e.target.value)}
            />
          </div>

          {error && <p className="text-[12px] text-accent-red">{error}</p>}
        </div>

        <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Action'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

ActionEditorDialog.displayName = 'ActionEditorDialog';

export default ActionEditorDialog;

import { X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/shared/store/projectStore';
import type { PromptResource } from '@/shared/types/library';
import { Button } from '@/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/Dialog';

import { savePrompt, updatePrompt } from '../api/libraryApi';

const EMPTY_FORM = {
  name: '',
  description: '',
  content: '',
  slash: '',
  tags: '',
  scope: 'global' as 'global' | 'project',
  kind: 'prompt' as 'prompt' | 'command',
  variables: '',
};

type FormState = typeof EMPTY_FORM;

function parseTags(input: string): string[] {
  return input
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseVariables(input: string): PromptResource['variables'] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map(
        (v: { name: string; description?: string; default?: string; required?: boolean }) => ({
          name: String(v.name ?? ''),
          description: v.description ? String(v.description) : undefined,
          default: v.default ? String(v.default) : undefined,
          required: Boolean(v.required),
        }),
      );
    }
  } catch {
    // Fallback: comma-separated variable names
    return trimmed.split(',').map((name) => ({ name: trimOr(name), required: false }));
  }
  return [];
}

function trimOr(s: string): string {
  return s.trim();
}

const PromptEditorDialog: React.FC = React.memo(() => {
  const open = useLibraryStore(
    (s) => s.editorOpen && (s.editorKind === 'prompt' || s.editorKind === 'command'),
  );
  const editing = useLibraryStore((s) => s.editingPrompt);
  const initialContent = useLibraryStore((s) => s.initialContent);
  const pendingKind = useLibraryStore((s) => s.pendingKind);
  const closeEditor = useLibraryStore((s) => s.closeEditor);
  const refreshPrompts = useLibraryStore((s) => s.refreshPrompts);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.name,
        description: editing.description ?? '',
        content: editing.content,
        slash: editing.slash ?? '',
        tags: editing.tags.join(', '),
        scope: editing.scope,
        kind: (editing.kind as 'prompt' | 'command') ?? 'prompt',
        variables: JSON.stringify(editing.variables ?? [], null, 2),
      });
    } else if (initialContent) {
      // Pre-filled from "Save as Prompt" — keep defaults for the rest.
      setForm({ ...EMPTY_FORM, content: initialContent });
    } else {
      setForm({ ...EMPTY_FORM, kind: pendingKind });
    }
    setError(null);
  }, [open, editing, initialContent, pendingKind]);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    const name = form.name.trim();
    const content = form.content.trim();
    if (!name) {
      setError('Name is required');
      return;
    }
    if (!content) {
      setError('Content is required');
      return;
    }
    const slash = form.slash.trim() || null;
    const tags = parseTags(form.tags);
    const variables = parseVariables(form.variables);
    const scope = form.scope;
    const kind = form.kind;
    const projectId = scope === 'project' ? activeProjectId : null;

    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updatePrompt(editing.id, {
          name,
          description: form.description.trim() || null,
          content,
          slash,
          tags,
          scope,
          projectId,
          kind,
          variables,
          favorite: editing.favorite,
        });
      } else {
        await savePrompt({
          name,
          description: form.description.trim() || null,
          content,
          slash,
          tags,
          scope,
          projectId,
          kind,
          variables,
        });
      }
      await refreshPrompts();
      // Also refresh commands list in case kind changed.
      await useLibraryStore.getState().refreshCommands();
      closeEditor();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [form, editing, activeProjectId, closeEditor, refreshPrompts]);

  const handleClose = useCallback(() => {
    closeEditor();
  }, [closeEditor]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-[640px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b border-border">
          <DialogTitle className="text-sm font-semibold">
            {editing ? 'Edit Prompt' : 'New Prompt'}
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
              htmlFor="prompt-name"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Name
            </label>
            <input
              id="prompt-name"
              className={cn(
                'w-full h-8 px-2.5 text-[var(--font-size)] rounded-md',
                'bg-bg-primary border border-border text-text-primary',
                'outline-none focus:border-accent-blue placeholder:text-text-muted',
              )}
              placeholder="e.g. Code Review Checklist"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
            />
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="prompt-description"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Description
            </label>
            <input
              id="prompt-description"
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

          {/* Content */}
          <div>
            <label
              htmlFor="prompt-content"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Content
            </label>
            <textarea
              id="prompt-content"
              className={cn(
                'w-full min-h-[160px] px-2.5 py-2 text-[var(--font-size)] rounded-md resize-y',
                'bg-bg-primary border border-border text-text-primary font-mono',
                'outline-none focus:border-accent-blue placeholder:text-text-muted',
              )}
              placeholder="Prompt body — supports {{branch}}, {{project}}, {{path}} etc."
              value={form.content}
              onChange={(e) => update('content', e.target.value)}
            />
          </div>

          {/* Slash */}
          <div>
            <label
              htmlFor="prompt-slash"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Slash command
            </label>
            <div className="flex items-center gap-2">
              <span className="text-[var(--font-size)] text-text-muted">/</span>
              <input
                id="prompt-slash"
                className={cn(
                  'flex-1 h-8 px-2.5 text-[var(--font-size)] rounded-md',
                  'bg-bg-primary border border-border text-text-primary',
                  'outline-none focus:border-accent-blue placeholder:text-text-muted',
                )}
                placeholder="review"
                value={form.slash}
                onChange={(e) => update('slash', e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
              />
            </div>
            <p className="mt-1 text-[10.5px] text-text-muted">
              Type /{form.slash || '…'} in the agent input to trigger this prompt.
            </p>
          </div>

          {/* Tags */}
          <div>
            <label
              htmlFor="prompt-tags"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Tags
            </label>
            <input
              id="prompt-tags"
              className={cn(
                'w-full h-8 px-2.5 text-[var(--font-size)] rounded-md',
                'bg-bg-primary border border-border text-text-primary',
                'outline-none focus:border-accent-blue placeholder:text-text-muted',
              )}
              placeholder="git, review, backend  (comma separated)"
              value={form.tags}
              onChange={(e) => update('tags', e.target.value)}
            />
          </div>

          {/* Scope */}
          <div>
            <span
              id="prompt-scope-label"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Scope
            </span>
            <div role="radiogroup" aria-labelledby="prompt-scope-label" className="flex gap-2">
              <button
                type="button"
                className={cn(
                  'h-8 px-3 text-[var(--font-size)] rounded-md border transition-colors',
                  form.scope === 'global'
                    ? 'bg-bg-selected text-text-primary border-accent-blue'
                    : 'bg-bg-primary text-text-secondary border-border hover:bg-bg-hover',
                )}
                onClick={() => update('scope', 'global')}
              >
                Global
              </button>
              <button
                type="button"
                className={cn(
                  'h-8 px-3 text-[var(--font-size)] rounded-md border transition-colors',
                  form.scope === 'project'
                    ? 'bg-bg-selected text-text-primary border-accent-blue'
                    : 'bg-bg-primary text-text-secondary border-border hover:bg-bg-hover',
                )}
                onClick={() => update('scope', 'project')}
                title={activeProjectId ? undefined : 'Select a project first'}
              >
                Project
              </button>
            </div>
            {form.scope === 'project' && !activeProjectId && (
              <p className="mt-1 text-[10.5px] text-accent-red">
                Select a project to scope this prompt.
              </p>
            )}
          </div>

          {/* Kind (prompt vs command) */}
          <div>
            <span
              id="prompt-kind-label"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Type
            </span>
            <div role="radiogroup" aria-labelledby="prompt-kind-label" className="flex gap-2">
              <button
                type="button"
                className={cn(
                  'h-8 px-3 text-[var(--font-size)] rounded-md border transition-colors',
                  form.kind === 'prompt'
                    ? 'bg-bg-selected text-text-primary border-accent-blue'
                    : 'bg-bg-primary text-text-secondary border-border hover:bg-bg-hover',
                )}
                onClick={() => update('kind', 'prompt')}
              >
                Prompt
              </button>
              <button
                type="button"
                className={cn(
                  'h-8 px-3 text-[var(--font-size)] rounded-md border transition-colors',
                  form.kind === 'command'
                    ? 'bg-bg-selected text-text-primary border-accent-blue'
                    : 'bg-bg-primary text-text-secondary border-border hover:bg-bg-hover',
                )}
                onClick={() => update('kind', 'command')}
              >
                Command
              </button>
            </div>
            <p className="mt-1 text-[10.5px] text-text-muted">
              {form.kind === 'command'
                ? 'Commands are slash-triggered templates that deploy to agent command directories.'
                : 'Prompts are reusable text blocks for your agents.'}
            </p>
          </div>

          {/* Variables (advanced) */}
          <details className="group">
            <summary className="cursor-pointer text-[11px] font-medium text-text-muted hover:text-text-primary select-none">
              Variables (advanced)
            </summary>
            <textarea
              id="prompt-variables"
              className={cn(
                'mt-1 w-full min-h-[80px] px-2.5 py-2 text-[var(--font-size)] rounded-md resize-y font-mono',
                'bg-bg-primary border border-border text-text-primary',
                'outline-none focus:border-accent-blue placeholder:text-text-muted',
              )}
              placeholder='[{"name":"branch","description":"Target branch","default":"main","required":false}]'
              value={form.variables}
              onChange={(e) => update('variables', e.target.value)}
            />
          </details>

          {error && <p className="text-[12px] text-accent-red">{error}</p>}
        </div>

        <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Prompt'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

PromptEditorDialog.displayName = 'PromptEditorDialog';

export default PromptEditorDialog;

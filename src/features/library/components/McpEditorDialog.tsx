import { X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import { useMcpStore } from '@/features/library/store/mcpStore';
import { useLibraryStore } from '@/features/library/store/libraryStore';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/shared/store/projectStore';
import { Button } from '@/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/Dialog';

interface FormState {
  name: string;
  description: string;
  command: string;
  args: string;
  env: string;
  transport: 'stdio' | 'sse' | 'http';
  url: string;
  scope: 'global' | 'project';
  tags: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  command: '',
  args: '[]',
  env: '{}',
  transport: 'stdio',
  url: '',
  scope: 'global',
  tags: '',
};

function parseTags(input: string): string[] {
  return input
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

const McpEditorDialog: React.FC = React.memo(() => {
  const open = useMcpStore((s) => s.editingMcpServer !== null);
  const editing = useMcpStore((s) => s.editingMcpServer);
  const closeEditor = useLibraryStore((s) => s.closeEditor);
  const closeMcpEditor = useMcpStore((s) => s.closeMcpEditor);
  const createMcpServer = useMcpStore((s) => s.createMcpServer);
  const updateMcpServer = useMcpStore((s) => s.updateMcpServer);
  const refreshMcpServers = useMcpStore((s) => s.refreshMcpServers);
  const setMcpDraft = useMcpStore((s) => s.setMcpDraft);
  const setMcpView = useMcpStore((s) => s.setMcpView);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRemote = form.transport === 'http' || form.transport === 'sse';

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.name,
        description: editing.description ?? '',
        command: editing.command,
        args: JSON.stringify(editing.args ?? [], null, 2),
        env: JSON.stringify(editing.env ?? {}, null, 2),
        transport: editing.transport,
        url: editing.url ?? '',
        scope: editing.scope,
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

    if (isRemote) {
      if (!form.url.trim()) {
        setError('URL is required for remote transport');
        return;
      }
    } else {
      if (!form.command.trim()) {
        setError('Command is required');
        return;
      }
    }

    let args: unknown[];
    try {
      const parsed = JSON.parse(form.args.trim() || '[]');
      if (!Array.isArray(parsed)) {
        setError('Args must be a JSON array');
        return;
      }
      args = parsed;
    } catch {
      setError('Args must be valid JSON');
      return;
    }

    let env: Record<string, string>;
    try {
      const parsed = JSON.parse(form.env.trim() || '{}');
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setError('Env must be a JSON object');
        return;
      }
      env = parsed as Record<string, string>;
    } catch {
      setError('Env must be valid JSON');
      return;
    }

    const tags = parseTags(form.tags);
    const scope = form.scope;
    const projectId = scope === 'project' ? activeProjectId : null;

    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateMcpServer(editing.id, {
          name,
          description: form.description.trim() || null,
          command: isRemote ? '' : form.command,
          url: isRemote ? form.url.trim() : null,
          args: args as string[],
          env,
          transport: form.transport,
          scope,
          projectId,
          tags,
        });
      } else {
        await createMcpServer({
          name,
          description: form.description.trim() || null,
          command: isRemote ? '' : form.command,
          url: isRemote ? form.url.trim() : null,
          args: args as string[],
          env,
          transport: form.transport,
          scope,
          projectId,
          tags,
        });
      }
      await refreshMcpServers();
      setMcpDraft(null);
      setMcpView('installed');
      closeMcpEditor();
      closeEditor();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [
    form,
    editing,
    isRemote,
    activeProjectId,
    closeEditor,
    closeMcpEditor,
    createMcpServer,
    updateMcpServer,
    refreshMcpServers,
    setMcpDraft,
    setMcpView,
  ]);

  const handleClose = useCallback(() => {
    setMcpDraft(null);
    closeMcpEditor();
    closeEditor();
  }, [closeEditor, closeMcpEditor, setMcpDraft]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-[640px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b border-border">
          <DialogTitle className="text-sm font-semibold">
            {editing ? 'Edit MCP Server' : 'New MCP Server'}
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
              htmlFor="mcp-name"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Name
            </label>
            <input
              id="mcp-name"
              className={cn(
                'w-full h-8 px-2.5 text-[var(--font-size)] rounded-md',
                'bg-bg-primary border border-border text-text-primary',
                'outline-none focus:border-accent-blue placeholder:text-text-muted',
              )}
              placeholder="e.g. filesystem"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
            />
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="mcp-description"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Description
            </label>
            <input
              id="mcp-description"
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

          {/* Command (hidden for remote transport) */}
          {!isRemote && (
            <div>
              <label
                htmlFor="mcp-command"
                className="block text-[11px] font-medium text-text-muted mb-1"
              >
                Command
              </label>
              <input
                id="mcp-command"
                className={cn(
                  'w-full h-8 px-2.5 text-[var(--font-size)] rounded-md font-mono',
                  'bg-bg-primary border border-border text-text-primary',
                  'outline-none focus:border-accent-blue placeholder:text-text-muted',
                )}
                placeholder="e.g. npx"
                value={form.command}
                onChange={(e) => update('command', e.target.value)}
              />
            </div>
          )}

          {/* URL (shown only for remote transport) */}
          {isRemote && (
            <div>
              <label
                htmlFor="mcp-url"
                className="block text-[11px] font-medium text-text-muted mb-1"
              >
                URL
              </label>
              <input
                id="mcp-url"
                className={cn(
                  'w-full h-8 px-2.5 text-[var(--font-size)] rounded-md font-mono',
                  'bg-bg-primary border border-border text-text-primary',
                  'outline-none focus:border-accent-blue placeholder:text-text-muted',
                )}
                placeholder="https://example.com/mcp"
                value={form.url}
                onChange={(e) => update('url', e.target.value)}
              />
            </div>
          )}

          {/* Args (hidden for remote transport) */}
          {!isRemote && (
            <div>
              <label
                htmlFor="mcp-args"
                className="block text-[11px] font-medium text-text-muted mb-1"
              >
                Args (JSON array)
              </label>
              <textarea
                id="mcp-args"
                className={cn(
                  'w-full min-h-[60px] px-2.5 py-2 text-[var(--font-size)] rounded-md resize-y font-mono',
                  'bg-bg-primary border border-border text-text-primary',
                  'outline-none focus:border-accent-blue placeholder:text-text-muted',
                )}
                placeholder='["-y", "@modelcontextprotocol/server-filesystem", "/path"]'
                value={form.args}
                onChange={(e) => update('args', e.target.value)}
              />
            </div>
          )}

          {/* Env */}
          <div>
            <label htmlFor="mcp-env" className="block text-[11px] font-medium text-text-muted mb-1">
              Environment (JSON object)
            </label>
            <textarea
              id="mcp-env"
              className={cn(
                'w-full min-h-[60px] px-2.5 py-2 text-[var(--font-size)] rounded-md resize-y font-mono',
                'bg-bg-primary border border-border text-text-primary',
                'outline-none focus:border-accent-blue placeholder:text-text-muted',
              )}
              placeholder='{"API_KEY": "your-key"}'
              value={form.env}
              onChange={(e) => update('env', e.target.value)}
            />
          </div>

          {/* Transport */}
          <div>
            <span
              id="mcp-transport-label"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Transport
            </span>
            <div role="radiogroup" aria-labelledby="mcp-transport-label" className="flex gap-2">
              {(['stdio', 'sse', 'http'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={cn(
                    'h-8 px-3 text-[var(--font-size)] rounded-md border transition-colors',
                    form.transport === t
                      ? 'bg-bg-selected text-text-primary border-accent-blue'
                      : 'bg-bg-primary text-text-secondary border-border hover:bg-bg-hover',
                  )}
                  onClick={() => update('transport', t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Scope */}
          <div>
            <span
              id="mcp-scope-label"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Scope
            </span>
            <div role="radiogroup" aria-labelledby="mcp-scope-label" className="flex gap-2">
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
                Select a project to scope this server.
              </p>
            )}
          </div>

          {/* Tags */}
          <div>
            <label
              htmlFor="mcp-tags"
              className="block text-[11px] font-medium text-text-muted mb-1"
            >
              Tags
            </label>
            <input
              id="mcp-tags"
              className={cn(
                'w-full h-8 px-2.5 text-[var(--font-size)] rounded-md',
                'bg-bg-primary border border-border text-text-primary',
                'outline-none focus:border-accent-blue placeholder:text-text-muted',
              )}
              placeholder="fs, tools, search  (comma separated)"
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
            {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Server'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

McpEditorDialog.displayName = 'McpEditorDialog';

export default McpEditorDialog;

import { AlertTriangle, X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import { useMcpStore } from '@/features/library/store/mcpStore';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/shared/store/projectStore';
import { Button } from '@/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/Dialog';

import McpConfigInputs from './McpConfigInputs';

/**
 * Lightweight marketplace install dialog. The launch config (command/args/env/
 * transport) comes pre-generated from the registry — the user only fills in
 * secret env values, server-declared config inputs, and picks a scope. This is
 * intentionally distinct from the full create/edit form in McpEditorDialog.
 */
const McpInstallDialog: React.FC = React.memo(() => {
  const open = useMcpStore((s) => s.installOpen);
  const draft = useMcpStore((s) => s.mcpDraft);
  const summary = useMcpStore((s) => s.mcpInstallSummary);
  const createMcpServer = useMcpStore((s) => s.createMcpServer);
  const refreshMcpServers = useMcpStore((s) => s.refreshMcpServers);
  const closeMcpInstall = useMcpStore((s) => s.closeMcpInstall);
  const setMcpView = useMcpStore((s) => s.setMcpView);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const [values, setValues] = useState<Record<string, string>>({});
  const [scope, setScope] = useState<'global' | 'project'>('global');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRemote = draft?.transport === 'http' || draft?.transport === 'sse';

  useEffect(() => {
    if (!open) return;
    setValues({});
    setScope('global');
    setError(null);
  }, [open]);

  const updateValue = useCallback((name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleInstall = useCallback(async () => {
    if (!draft) return;

    for (const ev of draft.env) {
      if (ev.isSecret && ev.isRequired && !values[ev.name]?.trim()) {
        setError(`Secret "${ev.name}" is required`);
        return;
      }
    }
    for (const input of draft.inputs ?? []) {
      if (input.isRequired && !values[input.name]?.trim()) {
        setError(`"${input.name}" is required`);
        return;
      }
    }

    const env: Record<string, string> = {};
    for (const ev of draft.env) {
      if (!ev.isSecret && ev.default != null) env[ev.name] = ev.default;
    }
    for (const [key, value] of Object.entries(values)) {
      const trimmed = value?.trim();
      if (trimmed) env[key] = trimmed;
    }

    setSaving(true);
    setError(null);
    try {
      await createMcpServer({
        name: draft.name,
        description: draft.description,
        command: isRemote ? '' : draft.command,
        url: isRemote ? (draft.url ?? undefined) : null,
        args: draft.args,
        env,
        transport: draft.transport,
        scope,
        projectId: scope === 'project' ? activeProjectId : null,
        sourceRegistry: 'registry.modelcontextprotocol.io',
        sourceRef: summary?.name ?? draft.name,
        tags: [],
      });
      await refreshMcpServers();
      setMcpView('installed');
      closeMcpInstall();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [
    draft,
    values,
    scope,
    isRemote,
    summary,
    activeProjectId,
    createMcpServer,
    refreshMcpServers,
    setMcpView,
    closeMcpInstall,
  ]);

  const handleClose = useCallback(() => {
    closeMcpInstall();
  }, [closeMcpInstall]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-[640px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b border-border">
          <DialogTitle className="text-sm font-semibold">
            {summary ? `Install · ${summary.title}` : 'Install from Marketplace'}
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
          {/* Safety warning */}
          <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-md bg-accent-yellow/10 border border-accent-yellow/20">
            <AlertTriangle className="h-3.5 w-3.5 text-accent-yellow shrink-0 mt-0.5" />
            <span className="text-[10.5px] text-accent-yellow leading-snug">
              MCP servers can execute arbitrary code. Review the generated config and fill in any
              secret values before installing.
            </span>
          </div>

          {/* Read-only server summary */}
          {draft && (
            <div className="rounded-md border border-border p-3 space-y-2 bg-bg-primary/40">
              <div className="flex items-center gap-2 min-w-0">
                <h4 className="flex-1 min-w-0 text-[13px] font-semibold text-text-primary truncate">
                  {summary?.title ?? draft.name}
                </h4>
                {summary?.version && (
                  <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted border border-border tabular-nums">
                    {summary.version}
                  </span>
                )}
                <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue border border-accent-blue/20">
                  {draft.transport}
                </span>
              </div>
              {draft.description && (
                <p className="text-[11px] text-text-muted leading-snug">{draft.description}</p>
              )}
              <dl className="space-y-1">
                <div className="flex items-center gap-2 min-w-0">
                  <dt className="text-[11px] text-text-muted w-16 shrink-0">Source</dt>
                  <dd className="text-[11px] text-text-secondary truncate font-mono">
                    {summary?.name ?? draft.name}
                  </dd>
                </div>
                {!isRemote && draft.command && (
                  <div className="flex items-center gap-2 min-w-0">
                    <dt className="text-[11px] text-text-muted w-16 shrink-0">Command</dt>
                    <dd className="text-[11px] text-text-secondary truncate font-mono">
                      {draft.command}
                    </dd>
                  </div>
                )}
                {!isRemote && draft.args.length > 0 && (
                  <div className="flex items-center gap-2 min-w-0">
                    <dt className="text-[11px] text-text-muted w-16 shrink-0">Args</dt>
                    <dd className="text-[11px] text-text-secondary truncate font-mono">
                      {draft.args.join(' ')}
                    </dd>
                  </div>
                )}
                {isRemote && draft.url && (
                  <div className="flex items-center gap-2 min-w-0">
                    <dt className="text-[11px] text-text-muted w-16 shrink-0">URL</dt>
                    <dd className="text-[11px] text-text-secondary truncate font-mono">
                      {draft.url}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Config-only section: secret env + dynamic config inputs */}
          {draft && (
            <McpConfigInputs
              env={draft.env}
              inputs={draft.inputs ?? []}
              values={values}
              onChange={updateValue}
            />
          )}

          {/* Scope */}
          {draft && (
            <div>
              <span
                id="mcp-install-scope-label"
                className="block text-[11px] font-medium text-text-muted mb-1"
              >
                Scope
              </span>
              <div
                role="radiogroup"
                aria-labelledby="mcp-install-scope-label"
                className="flex gap-2"
              >
                <button
                  type="button"
                  className={cn(
                    'h-8 px-3 text-[var(--font-size)] rounded-md border transition-colors',
                    scope === 'global'
                      ? 'bg-bg-selected text-text-primary border-accent-blue'
                      : 'bg-bg-primary text-text-secondary border-border hover:bg-bg-hover',
                  )}
                  onClick={() => setScope('global')}
                >
                  Global
                </button>
                <button
                  type="button"
                  className={cn(
                    'h-8 px-3 text-[var(--font-size)] rounded-md border transition-colors',
                    scope === 'project'
                      ? 'bg-bg-selected text-text-primary border-accent-blue'
                      : 'bg-bg-primary text-text-secondary border-border hover:bg-bg-hover',
                  )}
                  onClick={() => setScope('project')}
                  title={activeProjectId ? undefined : 'Select a project first'}
                >
                  Project
                </button>
              </div>
              {scope === 'project' && !activeProjectId && (
                <p className="mt-1 text-[10.5px] text-accent-red">
                  Select a project to scope this server.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-[12px] text-accent-red">{error}</p>}
        </div>

        <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleInstall()}
            disabled={saving || !draft}
          >
            {saving ? 'Installing...' : 'Install'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

McpInstallDialog.displayName = 'McpInstallDialog';

export default McpInstallDialog;

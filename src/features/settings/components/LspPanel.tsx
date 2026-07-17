import React, { useCallback, useState } from 'react';

import type { AppConfig, CustomLspServerConfig, LspAutoStart, LspConfig } from '@/features/settings/types';
import { lspGetExtensionMap } from '@/features/lsp/api/lspApi';
import { applyCustomServersFromConfig, setCustomLspExtensionMap } from '@/features/lsp/languageMap';
import { cn } from '@/lib/utils';

interface LspPanelProps {
  config: AppConfig;
  /** Must persist the full AppConfig (including `lsp`) to config.json. */
  onConfigChange: (next: AppConfig) => void | Promise<void>;
}

const DEFAULT_LSP: LspConfig = {
  autoStart: 'onFirstFile',
  deactivateStopMinutes: 30,
  customServers: [],
};

function newServerDraft(): CustomLspServerConfig {
  return {
    id: crypto.randomUUID(),
    languageId: '',
    displayName: '',
    command: [''],
    file_extensions: [],
    rootMarkers: [],
    autoStart: 'onFirstFile',
  };
}

async function refreshFrontendExtensionMap(): Promise<void> {
  try {
    const map = await lspGetExtensionMap();
    setCustomLspExtensionMap(
      map.map((e) => ({
        extension: e.extension,
        languageId: e.languageId,
        serverName: e.serverName,
        isCustom: e.isCustom,
      })),
    );
  } catch (e) {
    console.warn('[LSP] Failed to refresh extension map:', e);
  }
}

const LspPanel: React.FC<LspPanelProps> = ({ config, onConfigChange }) => {
  const lsp: LspConfig = {
    ...DEFAULT_LSP,
    ...(config.lsp ?? {}),
    customServers: config.lsp?.customServers ?? [],
  };
  const [draft, setDraft] = useState<CustomLspServerConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Write `config.lsp` into global AppConfig → ~/.neeko/config.json */
  const persistLsp = useCallback(
    async (nextLsp: LspConfig) => {
      const nextConfig: AppConfig = {
        ...config,
        lsp: nextLsp,
      };
      applyCustomServersFromConfig(nextLsp.customServers);
      await onConfigChange(nextConfig);
      // Backend save_config already applied settings; refresh FE router from registry
      await refreshFrontendExtensionMap();
    },
    [config, onConfigChange],
  );

  const patchLsp = useCallback(
    async (partial: Partial<LspConfig>) => {
      setSaving(true);
      setError(null);
      try {
        await persistLsp({ ...lsp, ...partial });
      } catch (e) {
        setError(String(e));
        console.error('[LSP] Failed to save settings to config.json:', e);
      } finally {
        setSaving(false);
      }
    },
    [lsp, persistLsp],
  );

  const handleSaveDraft = async () => {
    if (!draft) return;
    setError(null);
    const languageId = draft.languageId.trim();
    const command = draft.command.map((c) => c.trim()).filter(Boolean);
    const file_extensions = draft.file_extensions
      .map((e) => e.replace(/^\./, '').trim().toLowerCase())
      .filter(Boolean);

    if (!languageId) {
      setError('languageId is required');
      return;
    }
    if (command.length === 0) {
      setError('command is required (e.g. foo-lsp --stdio)');
      return;
    }
    if (file_extensions.length === 0) {
      setError('at least one file_extension is required');
      return;
    }

    const entry: CustomLspServerConfig = {
      ...draft,
      languageId,
      command,
      file_extensions,
      rootMarkers: (draft.rootMarkers ?? []).map((m) => m.trim()).filter(Boolean),
    };

    const others = lsp.customServers.filter((s) => s.id !== entry.id);
    const nextServers = [...others, entry];

    setSaving(true);
    try {
      await persistLsp({ ...lsp, customServers: nextServers });
      setDraft(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    const nextServers = lsp.customServers.filter((s) => s.id !== id);
    await patchLsp({ customServers: nextServers });
  };

  return (
    <div className="flex flex-col gap-6 p-4 text-sm text-text-primary max-w-2xl">
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-medium">Language Servers</h3>
        <p className="text-text-muted text-xs">
          Global settings stored in <code className="text-text-secondary">~/.neeko/config.json</code>{' '}
          under the <code className="text-text-secondary">lsp</code> key. Projects are detected from
          root markers; servers start when you open a matching file by default.
        </p>

        <label className="flex flex-col gap-1">
          <span className="text-text-secondary text-xs">Default auto-start</span>
          <select
            className="bg-bg-secondary border border-border rounded px-2 py-1.5"
            value={lsp.autoStart}
            disabled={saving}
            onChange={(e) => void patchLsp({ autoStart: e.target.value as LspAutoStart })}
          >
            <option value="onFirstFile">On first file (recommended)</option>
            <option value="onProjectSelect">On project select</option>
            <option value="manual">Manual only</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-text-secondary text-xs">
            Stop servers after leaving project (minutes)
          </span>
          <input
            type="number"
            min={1}
            max={24 * 60}
            disabled={saving}
            className="bg-bg-secondary border border-border rounded px-2 py-1.5 w-32"
            value={lsp.deactivateStopMinutes}
            onChange={(e) =>
              void patchLsp({
                deactivateStopMinutes: Math.max(1, Number(e.target.value) || 30),
              })
            }
          />
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium">Custom servers</h3>
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border border-border hover:bg-hover"
            disabled={saving}
            onClick={() => setDraft(newServerDraft())}
          >
            Add server
          </button>
        </div>

        {lsp.customServers.length === 0 && !draft && (
          <p className="text-text-muted text-xs">
            No custom servers. Add one to bind file extensions (e.g. proto → buf lsp).
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {lsp.customServers.map((s) => (
            <li
              key={s.id}
              className="flex items-start justify-between gap-2 border border-border rounded px-3 py-2 bg-bg-secondary"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {s.displayName || s.languageId}
                  <span className="text-text-muted font-normal"> · {s.languageId}</span>
                </div>
                <div className="text-xs text-text-muted truncate">
                  {s.command.join(' ')} · *.{s.file_extensions.join(', *.')}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  type="button"
                  className="text-xs px-1.5 py-0.5 hover:text-text-primary text-text-muted"
                  onClick={() => setDraft({ ...s })}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="text-xs px-1.5 py-0.5 hover:text-status-error text-text-muted"
                  onClick={() => void handleRemove(s.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>

        {draft && (
          <div className="border border-border rounded p-3 flex flex-col gap-2 bg-bg-tertiary">
            <h4 className="text-xs font-medium text-text-secondary">
              {lsp.customServers.some((s) => s.id === draft.id) ? 'Edit' : 'New'} server
            </h4>
            <label className="flex flex-col gap-0.5 text-xs">
              Language ID
              <input
                className="bg-bg-secondary border border-border rounded px-2 py-1"
                value={draft.languageId}
                onChange={(e) => setDraft({ ...draft, languageId: e.target.value })}
                placeholder="protobuf"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs">
              Display name
              <input
                className="bg-bg-secondary border border-border rounded px-2 py-1"
                value={draft.displayName ?? ''}
                onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                placeholder="Buf LSP"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs">
              Command (space-separated)
              <input
                className="bg-bg-secondary border border-border rounded px-2 py-1 font-mono"
                value={draft.command.join(' ')}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    command: e.target.value.split(/\s+/).filter(Boolean),
                  })
                }
                placeholder="buf beta lsp"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs">
              File extensions (comma-separated, no dots)
              <input
                className="bg-bg-secondary border border-border rounded px-2 py-1"
                value={draft.file_extensions.join(', ')}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    file_extensions: e.target.value
                      .split(/[,\s]+/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="proto"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs">
              Root markers (comma-separated, optional)
              <input
                className="bg-bg-secondary border border-border rounded px-2 py-1"
                value={(draft.rootMarkers ?? []).join(', ')}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    rootMarkers: e.target.value
                      .split(/[,\s]+/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="buf.yaml"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs">
              Auto-start
              <select
                className="bg-bg-secondary border border-border rounded px-2 py-1"
                value={draft.autoStart ?? 'onFirstFile'}
                onChange={(e) =>
                  setDraft({ ...draft, autoStart: e.target.value as LspAutoStart })
                }
              >
                <option value="onFirstFile">On first file</option>
                <option value="onProjectSelect">On project select</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            {error && <p className="text-status-error text-xs">{error}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border border-border hover:bg-hover"
                onClick={() => {
                  setDraft(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                className={cn(
                  'text-xs px-2 py-1 rounded border border-border bg-accent-blue text-text-on-accent disabled:opacity-50',
                )}
                onClick={() => void handleSaveDraft()}
              >
                {saving ? 'Saving…' : 'Save to config.json'}
              </button>
            </div>
          </div>
        )}
      </section>

      {error && !draft && (
        <p className="text-status-error text-xs">{error}</p>
      )}
    </div>
  );
};

export default React.memo(LspPanel);

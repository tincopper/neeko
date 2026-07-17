import React, { useCallback, useState } from 'react';

import type {
  AppConfig,
  CustomLspServerConfig,
  LspAutoStart,
  LspConfig,
} from '@/features/settings/types';
import { lspGetExtensionMap } from '@/features/lsp/api/lspApi';
import {
  applyCustomServersFromConfig,
  setCustomLspExtensionMap,
} from '@/features/lsp/languageMap';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  ToggleGroup,
  ToggleGroupItem,
} from '@/ui';

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

const AUTO_START_OPTIONS: { value: LspAutoStart; label: string }[] = [
  { value: 'onFirstFile', label: 'First file' },
  { value: 'onProjectSelect', label: 'Project select' },
  { value: 'manual', label: 'Manual' },
];

/** Form-local draft: list fields stay as raw strings so spaces/commas can be typed. */
interface ServerDraftForm {
  id: string;
  languageId: string;
  displayName: string;
  /** Free text, e.g. "buf beta lsp" — split on save */
  commandText: string;
  /** Free text, e.g. "proto, pb" — split on save */
  extensionsText: string;
  /** Free text, e.g. "buf.yaml, .foorc" — split on save */
  rootMarkersText: string;
  autoStart: LspAutoStart;
}

function emptyDraftForm(): ServerDraftForm {
  return {
    id: crypto.randomUUID(),
    languageId: '',
    displayName: '',
    commandText: '',
    extensionsText: '',
    rootMarkersText: '',
    autoStart: 'onFirstFile',
  };
}

function serverToDraftForm(s: CustomLspServerConfig): ServerDraftForm {
  return {
    id: s.id,
    languageId: s.languageId,
    displayName: s.displayName ?? '',
    commandText: s.command.join(' '),
    extensionsText: s.file_extensions.join(', '),
    rootMarkersText: (s.rootMarkers ?? []).join(', '),
    autoStart: s.autoStart ?? 'onFirstFile',
  };
}

/** Split command line on whitespace after trim. */
function parseCommandText(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** Split comma-separated list (spaces around items allowed). */
function parseCommaList(text: string): string[] {
  return text
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Extensions: comma list, strip leading dots, lowercase. */
function parseExtensionsText(text: string): string[] {
  return parseCommaList(text).map((e) => e.replace(/^\./, '').toLowerCase()).filter(Boolean);
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

/** Settings row: label + description left, control right — matches Editor/Git panels. */
function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.04] gap-6 last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="text-[0.86em] text-text-primary font-medium mb-0.75">{title}</div>
        <div className="text-[0.79em] text-text-muted leading-relaxed">{description}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 w-full">
      <span className="text-[0.79em] text-text-muted font-medium">{label}</span>
      {children}
      {hint ? (
        <span className="text-[0.72em] text-text-muted/80 leading-snug">{hint}</span>
      ) : null}
    </label>
  );
}

const LspPanel: React.FC<LspPanelProps> = ({ config, onConfigChange }) => {
  const lsp: LspConfig = {
    ...DEFAULT_LSP,
    ...(config.lsp ?? {}),
    customServers: config.lsp?.customServers ?? [],
  };
  const [draft, setDraft] = useState<ServerDraftForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const persistLsp = useCallback(
    async (nextLsp: LspConfig) => {
      const nextConfig: AppConfig = { ...config, lsp: nextLsp };
      applyCustomServersFromConfig(nextLsp.customServers);
      await onConfigChange(nextConfig);
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
        console.error('[LSP] Failed to save settings:', e);
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
    const command = parseCommandText(draft.commandText);
    const file_extensions = parseExtensionsText(draft.extensionsText);
    const rootMarkers = parseCommaList(draft.rootMarkersText);

    if (!languageId) {
      setError('Language ID is required');
      return;
    }
    if (command.length === 0) {
      setError('Command is required (e.g. gopls or buf beta lsp)');
      return;
    }
    if (file_extensions.length === 0) {
      setError('At least one file extension is required');
      return;
    }

    const entry: CustomLspServerConfig = {
      id: draft.id,
      languageId,
      displayName: draft.displayName.trim() || undefined,
      command,
      file_extensions,
      rootMarkers,
      autoStart: draft.autoStart,
    };

    const others = lsp.customServers.filter((s) => s.id !== entry.id);
    setSaving(true);
    try {
      await persistLsp({ ...lsp, customServers: [...others, entry] });
      setDraft(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    await patchLsp({ customServers: lsp.customServers.filter((s) => s.id !== id) });
  };

  const isEditing = draft != null && lsp.customServers.some((s) => s.id === draft.id);

  return (
    <>
      <h3 className="text-base font-semibold text-text-primary mb-1">Language Servers</h3>
      <p className="text-[0.79em] text-text-muted leading-relaxed mb-4">
        Global LSP policy and custom servers. Saved with app settings.
      </p>
      <Separator className="mb-1" />

      <SettingRow
        title="Auto-start"
        description="When to launch language servers for a project."
      >
        <ToggleGroup
          type="single"
          value={lsp.autoStart}
          disabled={saving}
          onValueChange={(value) => {
            if (value) void patchLsp({ autoStart: value as LspAutoStart });
          }}
        >
          {AUTO_START_OPTIONS.map((opt) => (
            <ToggleGroupItem key={opt.value} value={opt.value} className="text-[0.79em] px-2.5">
              {opt.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingRow>

      <SettingRow
        title="Idle stop after switch"
        description="Minutes after leaving a project before stopping its language servers."
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="size-7 bg-bg-tertiary border border-border rounded text-text-primary text-[1.07em] cursor-pointer flex items-center justify-center transition-colors duration-150 hover:bg-bg-hover disabled:opacity-35 disabled:cursor-not-allowed"
            disabled={saving || lsp.deactivateStopMinutes <= 1}
            onClick={() =>
              void patchLsp({
                deactivateStopMinutes: Math.max(1, lsp.deactivateStopMinutes - 5),
              })
            }
          >
            &minus;
          </button>
          <span className="min-w-[52px] text-center text-[0.86em] text-text-primary tabular-nums">
            {lsp.deactivateStopMinutes}m
          </span>
          <button
            type="button"
            className="size-7 bg-bg-tertiary border border-border rounded text-text-primary text-[1.07em] cursor-pointer flex items-center justify-center transition-colors duration-150 hover:bg-bg-hover disabled:opacity-35 disabled:cursor-not-allowed"
            disabled={saving || lsp.deactivateStopMinutes >= 24 * 60}
            onClick={() =>
              void patchLsp({
                deactivateStopMinutes: Math.min(24 * 60, lsp.deactivateStopMinutes + 5),
              })
            }
          >
            +
          </button>
        </div>
      </SettingRow>

      <div className="flex flex-col items-start gap-3 py-3 mt-2 border-b border-white/[0.04] last:border-b-0">
        <div className="flex w-full items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
              Custom servers
            </div>
            <div className="text-[0.79em] text-text-muted leading-relaxed">
              Bind extra file extensions to a language server command. Extensions take priority over
              built-ins.
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={saving || draft != null}
            onClick={() => setDraft(emptyDraftForm())}
          >
            Add server
          </Button>
        </div>

        {lsp.customServers.length > 0 && (
          <div className="w-full border border-border rounded overflow-hidden bg-bg-primary">
            {lsp.customServers.map((s, idx) => (
              <div
                key={s.id}
                className={
                  idx < lsp.customServers.length - 1
                    ? 'flex items-center gap-2.5 py-[7px] px-3 border-b border-white/[0.03] text-[0.86em]'
                    : 'flex items-center gap-2.5 py-[7px] px-3 text-[0.86em]'
                }
              >
                <div className="flex flex-col min-w-0 flex-1 gap-0.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-text-primary font-medium truncate">
                      {s.displayName || s.languageId}
                    </span>
                    <span className="text-text-muted text-[0.82em] shrink-0 font-mono">
                      {s.languageId}
                    </span>
                  </div>
                  <div className="text-text-muted font-mono text-[0.82em] truncate">
                    {s.command.join(' ')}
                    <span className="text-text-muted/80">
                      {' · '}
                      {s.file_extensions.map((e) => `*.${e}`).join(', ')}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="bg-none border-none text-text-muted cursor-pointer text-[0.79em] py-0.5 px-1.5 rounded shrink-0 hover:text-text-primary hover:bg-bg-hover"
                  onClick={() => setDraft(serverToDraftForm(s))}
                  title="Edit"
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="bg-none border-none text-text-muted cursor-pointer text-[0.79em] py-0.5 px-1 rounded shrink-0 hover:text-status-error hover:bg-bg-hover"
                  onClick={() => void handleRemove(s.id)}
                  title="Remove"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}

        {lsp.customServers.length === 0 && !draft && (
          <div className="w-full rounded border border-dashed border-border/80 bg-bg-primary/40 px-3 py-4 text-center text-[0.79em] text-text-muted">
            No custom servers yet. Example: bind{' '}
            <span className="font-mono text-text-secondary">proto</span> to{' '}
            <span className="font-mono text-text-secondary">buf beta lsp</span>.
          </div>
        )}

        {draft && (
          <div className="w-full rounded-md border border-border bg-bg-primary p-3.5 flex flex-col gap-3">
            <div className="text-[0.86em] text-text-primary font-medium">
              {isEditing ? 'Edit server' : 'New server'}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Language ID">
                <Input
                  value={draft.languageId}
                  onChange={(e) => setDraft({ ...draft, languageId: e.target.value })}
                  placeholder="protobuf"
                  className="h-9 py-1.5 text-[0.86em]"
                  autoComplete="off"
                />
              </Field>
              <Field label="Display name">
                <Input
                  value={draft.displayName}
                  onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                  placeholder="Buf LSP"
                  className="h-9 py-1.5 text-[0.86em] !font-sans"
                  autoComplete="off"
                />
              </Field>
            </div>

            <Field
              label="Command"
              hint="Space-separated arguments, e.g. buf beta lsp or gopls"
            >
              <Input
                value={draft.commandText}
                onChange={(e) => setDraft({ ...draft, commandText: e.target.value })}
                placeholder="buf beta lsp"
                className="h-9 py-1.5 text-[0.86em]"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="File extensions"
                hint="Comma-separated, without dots, e.g. proto, pb"
              >
                <Input
                  value={draft.extensionsText}
                  onChange={(e) => setDraft({ ...draft, extensionsText: e.target.value })}
                  placeholder="proto, pb"
                  className="h-9 py-1.5 text-[0.86em] !font-sans"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field
                label="Root markers (optional)"
                hint="Comma-separated filenames, e.g. buf.yaml, go.mod"
              >
                <Input
                  value={draft.rootMarkersText}
                  onChange={(e) => setDraft({ ...draft, rootMarkersText: e.target.value })}
                  placeholder="buf.yaml"
                  className="h-9 py-1.5 text-[0.86em] !font-sans"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
            </div>

            <Field label="Auto-start">
              <Select
                value={draft.autoStart}
                onValueChange={(value) =>
                  setDraft({ ...draft, autoStart: value as LspAutoStart })
                }
              >
                <SelectTrigger className="h-9 text-[0.86em] bg-bg-tertiary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="onFirstFile">On first file</SelectItem>
                  <SelectItem value="onProjectSelect">On project select</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {error && (
              <p className="text-[0.79em] text-status-error leading-relaxed">{error}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(null);
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={saving}
                onClick={() => void handleSaveDraft()}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {error && !draft && (
        <p className="mt-3 text-[0.79em] text-status-error leading-relaxed">{error}</p>
      )}
    </>
  );
};

export default React.memo(LspPanel);

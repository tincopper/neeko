import React, { useCallback, useMemo, useState } from 'react';

import {
  applyCustomServersFromConfig,
  applyBackendExtensionMap,
} from '@/features/lsp/api/languageMap';
import { lspGetExtensionMap } from '@/features/lsp/api/lspApi';
import { useLspStore } from '@/features/lsp/store/lspStore';
import type {
  AppConfig,
  LspAutoStart,
  LspConfig,
  LspImportStrategy,
} from '@/features/settings/types';
import { Separator, ToggleGroup, ToggleGroupItem } from '@/ui';

import LspCustomServersSection from './LspCustomServersSection';
import {
  AUTO_START_OPTIONS,
  buildServerEntry,
  DEFAULT_LSP,
  IMPORT_STRATEGY_OPTIONS,
  type ServerDraftForm,
} from './lspServerDraft';
import SettingRow from './SettingRow';

interface LspPanelProps {
  config: AppConfig;
  /** Must persist the full AppConfig (including `lsp`) to config.json. */
  onConfigChange: (next: AppConfig) => void | Promise<void>;
}

async function refreshFrontendExtensionMap(): Promise<void> {
  try {
    const map = await lspGetExtensionMap();
    applyBackendExtensionMap(
      map.map((e) => ({
        extension: e.extension,
        languageId: e.languageId,
        serverName: e.serverName,
        isCustom: e.isCustom,
      })),
    );
    await useLspStore.getState().refreshExtensionConflicts();
  } catch (e) {
    console.warn('[LSP] Failed to refresh extension map:', e);
  }
}

const LspPanel: React.FC<LspPanelProps> = ({ config, onConfigChange }) => {
  const lsp: LspConfig = useMemo(
    () => ({
      ...DEFAULT_LSP,
      ...(config.lsp ?? {}),
      importStrategy: config.lsp?.importStrategy ?? 'auto',
      customServers: config.lsp?.customServers ?? [],
    }),
    [config.lsp],
  );
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

    const built = buildServerEntry(draft);
    if (!built.ok) {
      setError(built.error);
      return;
    }

    const others = lsp.customServers.filter((s) => s.id !== built.entry.id);
    setSaving(true);
    try {
      await persistLsp({ ...lsp, customServers: [...others, built.entry] });
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

  return (
    <>
      <h3 className="text-base font-semibold text-text-primary mb-1">Language Servers</h3>
      <p className="text-[0.79em] text-text-muted leading-relaxed mb-4">
        Global LSP policy and custom servers. Saved with app settings.
      </p>
      <Separator className="mb-1" />

      <SettingRow title="Auto-start" description="When to launch language servers for a project.">
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
        title="Auto-import on completion"
        description="Whether accepting a completion also applies its import edits."
      >
        <ToggleGroup
          type="single"
          value={lsp.importStrategy}
          disabled={saving}
          onValueChange={(value) => {
            if (value) void patchLsp({ importStrategy: value as LspImportStrategy });
          }}
        >
          {IMPORT_STRATEGY_OPTIONS.map((opt) => (
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

      <LspCustomServersSection
        servers={lsp.customServers}
        draft={draft}
        setDraft={setDraft}
        saving={saving}
        error={error}
        setError={setError}
        onSaveDraft={handleSaveDraft}
        onRemove={handleRemove}
      />

      {error && !draft && (
        <p className="mt-3 text-[0.79em] text-status-error leading-relaxed">{error}</p>
      )}
    </>
  );
};

export default React.memo(LspPanel);

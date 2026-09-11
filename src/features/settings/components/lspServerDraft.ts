/** LSP 自定义服务的草稿表单模型与纯校验/解析逻辑（无 React 依赖，可直接单测）。 */

import type { CustomLspServerConfig, LspAutoStart, LspConfig } from '@/features/settings/types';

export const DEFAULT_LSP: LspConfig = {
  autoStart: 'onFirstFile',
  deactivateStopMinutes: 30,
  customServers: [],
};

export const AUTO_START_OPTIONS: { value: LspAutoStart; label: string }[] = [
  { value: 'onFirstFile', label: 'First file' },
  { value: 'onProjectSelect', label: 'Project select' },
  { value: 'manual', label: 'Manual' },
];

/** Form-local draft: list fields stay as raw strings so spaces/commas can be typed. */
export interface ServerDraftForm {
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
  /** Raw JSON for initializationOptions (optional). */
  initializationOptionsText: string;
}

export function emptyDraftForm(): ServerDraftForm {
  return {
    id: crypto.randomUUID(),
    languageId: '',
    displayName: '',
    commandText: '',
    extensionsText: '',
    rootMarkersText: '',
    autoStart: 'onFirstFile',
    initializationOptionsText: '',
  };
}

export function serverToDraftForm(s: CustomLspServerConfig): ServerDraftForm {
  return {
    id: s.id,
    languageId: s.languageId,
    displayName: s.displayName ?? '',
    commandText: s.command.join(' '),
    extensionsText: s.file_extensions.join(', '),
    rootMarkersText: (s.rootMarkers ?? []).join(', '),
    autoStart: s.autoStart ?? 'onFirstFile',
    initializationOptionsText:
      s.initializationOptions === undefined || s.initializationOptions === null
        ? ''
        : JSON.stringify(s.initializationOptions, null, 2),
  };
}

/** Split command line on whitespace after trim. */
export function parseCommandText(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** Split comma-separated list (spaces around items allowed). */
export function parseCommaList(text: string): string[] {
  return text
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Extensions: comma list, strip leading dots, lowercase. */
export function parseExtensionsText(text: string): string[] {
  return parseCommaList(text)
    .map((e) => e.replace(/^\./, '').toLowerCase())
    .filter(Boolean);
}

/** 草稿校验 + 构造结果：失败时给出面向用户的错误文案。 */
export type ServerDraftResult =
  | { ok: true; entry: CustomLspServerConfig }
  | { ok: false; error: string };

/**
 * 校验草稿并构造自定义服务条目。
 *
 * 校验顺序与原实现保持一致（languageId → command → extensions → JSON）。
 */
export function buildServerEntry(draft: ServerDraftForm): ServerDraftResult {
  const languageId = draft.languageId.trim();
  const command = parseCommandText(draft.commandText);
  const file_extensions = parseExtensionsText(draft.extensionsText);
  const rootMarkers = parseCommaList(draft.rootMarkersText);

  if (!languageId) {
    return { ok: false, error: 'Language ID is required' };
  }
  if (command.length === 0) {
    return { ok: false, error: 'Command is required (e.g. gopls or buf beta lsp)' };
  }
  if (file_extensions.length === 0) {
    return { ok: false, error: 'At least one file extension is required' };
  }

  let initializationOptions: unknown | undefined;
  const initText = draft.initializationOptionsText.trim();
  if (initText) {
    try {
      initializationOptions = JSON.parse(initText);
    } catch {
      return { ok: false, error: 'initializationOptions must be valid JSON (object or array)' };
    }
  }

  return {
    ok: true,
    entry: {
      id: draft.id,
      languageId,
      displayName: draft.displayName.trim() || undefined,
      command,
      file_extensions,
      rootMarkers,
      autoStart: draft.autoStart,
      initializationOptions,
    },
  };
}

/**
 * File extension → LSP language ID mapping.
 *
 * Built-in defaults are always present. Custom servers (from config.lsp)
 * are merged at runtime via `setCustomLspExtensionMap` so that opening a
 * matching file routes to the user-defined language server.
 *
 * Prefer {@link resolveLspLanguageId} when opening files so the live backend
 * registry (custom plugins) is authoritative; the local map is a sync cache.
 */

import * as lspApi from './api/lspApi';

const BUILTIN_LSP_LANGUAGE_MAP: Record<string, string> = {
  rs: 'rust',
  py: 'python',
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  go: 'go',
  java: 'java',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  lua: 'lua',
  ex: 'elixir',
  exs: 'elixir',
  r: 'r',
  sql: 'sql',
};

/** Custom overrides (extension without dot → languageId). Later wins. */
let customExtMap: Record<string, string> = {};

export interface LspExtensionMapEntry {
  extension: string;
  languageId: string;
  serverName: string;
  isCustom: boolean;
}

/**
 * Replace custom extension mappings from the backend registry.
 * Built-ins remain; custom entries override on conflict.
 */
export function setCustomLspExtensionMap(entries: LspExtensionMapEntry[]): void {
  const next: Record<string, string> = {};
  for (const e of entries) {
    if (!e.isCustom) continue;
    const ext = e.extension.replace(/^\./, '').toLowerCase();
    if (ext) next[ext] = e.languageId;
  }
  customExtMap = next;
}

/** Apply custom servers from AppConfig without waiting for backend. */
export function applyCustomServersFromConfig(
  servers: Array<{ languageId: string; file_extensions: string[] }>,
): void {
  const next: Record<string, string> = {};
  for (const s of servers) {
    for (const raw of s.file_extensions ?? []) {
      const ext = raw.replace(/^\./, '').toLowerCase();
      if (ext) next[ext] = s.languageId;
    }
  }
  customExtMap = next;
}

function extensionOf(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function getLspLanguageId(filePath: string): string | null {
  const ext = extensionOf(filePath);
  if (!ext) return null;
  return customExtMap[ext] ?? BUILTIN_LSP_LANGUAGE_MAP[ext] ?? null;
}

/**
 * Cache a live registry resolution so subsequent synchronous lookups match the backend.
 * Only writes into the custom map (does not mutate built-in defaults).
 */
export function cacheLiveLanguageResolution(filePath: string, languageId: string): void {
  const ext = extensionOf(filePath);
  const lang = languageId.trim();
  if (!ext || !lang) return;
  // Skip if already the effective mapping
  if (getLspLanguageId(filePath) === lang) return;
  customExtMap = { ...customExtMap, [ext]: lang };
}

/**
 * Resolve language id using the live backend registry (custom plugins first).
 * Falls back to the local extension map when the IPC call fails or returns null.
 * Successful live results are cached for subsequent sync lookups.
 */
export async function resolveLspLanguageId(filePath: string): Promise<string | null> {
  try {
    const live = await lspApi.lspResolveLanguage(filePath);
    if (live) {
      cacheLiveLanguageResolution(filePath, live);
      return live;
    }
  } catch {
    // offline / test environment — use local map
  }
  return getLspLanguageId(filePath);
}

export function toFileUri(projectPath: string, filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.startsWith('/')) {
    return `file://${normalized}`;
  }
  if (normalized.match(/^[A-Za-z]:/)) {
    return `file:///${normalized}`;
  }
  return `file://${projectPath.replace(/\\/g, '/')}/${normalized}`;
}

export function fromFileUri(uri: string): string {
  const withoutScheme = uri.startsWith('file://')
    ? uri.slice('file://'.length)
    : uri;
  return decodeURIComponent(withoutScheme);
}

export function isLspAvailable(extension: string): boolean {
  const ext = extension.replace(/^\./, '').toLowerCase();
  return ext in customExtMap || ext in BUILTIN_LSP_LANGUAGE_MAP;
}

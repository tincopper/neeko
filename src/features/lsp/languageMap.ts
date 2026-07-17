/**
 * File extension → LSP language ID mapping.
 *
 * Built-in defaults are always present. Custom servers (from config.lsp)
 * are merged at runtime via `setCustomLspExtensionMap` so that opening a
 * matching file routes to the user-defined language server.
 */

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

export function getLspLanguageId(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (!ext) return null;
  return customExtMap[ext] ?? BUILTIN_LSP_LANGUAGE_MAP[ext] ?? null;
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

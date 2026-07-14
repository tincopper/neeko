/**
 * Single source of truth for file extension → LSP language ID mapping.
 * Used by FileViewer, lspClientManager, StatusBar, and other LSP consumers.
 */
const LSP_LANGUAGE_MAP: Record<string, string> = {
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

export function getLspLanguageId(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return LSP_LANGUAGE_MAP[ext] ?? null;
}

export function toFileUri(projectPath: string, filePath: string): string {
  // Normalize Windows backslashes for file:// URI
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
  return extension.toLowerCase() in LSP_LANGUAGE_MAP;
}

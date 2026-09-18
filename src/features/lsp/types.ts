export interface LspSessionInfo {
  language_id: string;
  project_path: string;
  server_name: string;
  status: string;
  status_message?: string;
  progress_pct?: number;
}

/** Runtime metadata for a language server (submenu footer). camelCase from Rust. */
export interface LspServerInfo {
  version: string;
  commit: string;
  buildDate: string;
  memoryMb: number;
}

/** One stderr / log line from an LSP server process. camelCase from Rust. */
export interface LspServerLogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error' | string;
  message: string;
}

/** Root-marker detection result (no server spawn). camelCase from Rust serde. */
export interface DetectedLanguage {
  languageId: string;
  serverName: string;
  markers: string[];
}

export interface ProjectLanguageProfile {
  projectPath: string;
  primary: DetectedLanguage | null;
  candidates: DetectedLanguage[];
}

export interface LspSessionStatusEvent {
  languageId: string;
  status: string;
  message?: string;
  progressPct?: number;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: number | null;
  message: string;
  source: string | null;
  /** LSP Diagnostic.code（number|string，如 "UndeclaredName" / 2339）；多数服务器缺省。 */
  code?: string | number;
  /** LSP Diagnostic.codeDescription——target 为诊断文档外链（VS Code 中 code 渲染为可点链接）。 */
  codeDescription?: { href: string };
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface LspHoverResult {
  contents: LspMarkupContent[];
  range: LspRange | null;
}

export type LspMarkupContent = string | { kind: string; value: string };

export interface LspCompletionItem {
  label: string;
  kind: number | null;
  detail: string | null;
  insert_text: string | null;
}

export interface LspDiagnosticsEvent {
  uri: string;
  diagnostics: LspDiagnostic[];
}

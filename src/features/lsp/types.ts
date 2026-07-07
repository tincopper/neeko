export interface LspSessionInfo {
  language_id: string;
  project_path: string;
  server_name: string;
  connected: boolean;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: number | null;
  message: string;
  source: string | null;
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

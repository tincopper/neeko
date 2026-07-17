import type { AgentConfig } from "@/features/agent/types";

export type SkillView = "local" | "marketplace" | "project";
export type DiffMode = "unified" | "split";
export type AppTheme = string;

export const BUILTIN_THEMES = ["dark", "light", "one-dark-pro", "claude", "classic-dark"] as const;

export interface ThemeListItem {
  name: string;
  label: string;
  isBuiltin: boolean;
}

export interface CustomThemeData {
  name: string;
  variables: Record<string, string>;
}

/** Global LSP auto-start policy. */
export type LspAutoStart = 'onFirstFile' | 'onProjectSelect' | 'manual';

/** User-defined language server bound by file_extensions. */
export interface CustomLspServerConfig {
  id: string;
  languageId: string;
  displayName?: string;
  /** argv, e.g. ["foo-lsp", "--stdio"] */
  command: string[];
  /** Extensions without leading dots, e.g. ["proto", "foo"] */
  file_extensions: string[];
  rootMarkers?: string[];
  autoStart?: LspAutoStart;
}

export interface LspConfig {
  /** Default auto-start for built-in servers. */
  autoStart: LspAutoStart;
  /** Minutes after leaving a project before stopping its LSP sessions. */
  deactivateStopMinutes: number;
  customServers: CustomLspServerConfig[];
}

export interface AppConfig {
  theme: AppTheme;
  appearanceFontSize: number;
  editorFontSize: number;
  terminalFontSize: number;
  diffMode: DiffMode;
  shell: string;
  fontFamily: string;
  customIdes: { name: string; command: string }[];
  ideCommandOverrides: Record<string, string>;
  agentCommandOverrides: Record<string, string>;
  agentSkillPathOverrides: Record<string, string>;
  customAgents: AgentConfig[];
  agentSelectorShowPresetBar: boolean;
  agentSelectorCompactMode: boolean;
  hiddenAgentIds: string[];
  shortcuts: Record<string, string>;
  terminalGpuAcceleration: boolean;
  enablePiThemeSync: boolean;
  enableOpenCodeThemeSync: boolean;
  /** Language server settings (profile soft-warm, custom servers, idle recycle). */
  lsp: LspConfig;
}

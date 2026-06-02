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
}

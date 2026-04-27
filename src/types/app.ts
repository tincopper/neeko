import type { AgentConfig } from "./agent";

export type SkillView = "local" | "marketplace" | "project";
export type DiffMode = "unified" | "split";
export type AppTheme = "dark" | "light" | "one-dark-pro" | "claude";

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
}

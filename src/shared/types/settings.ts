import type { AgentConfig } from '@/shared/types/agent';

export type SkillView = 'local' | 'marketplace' | 'project' | 'agents';
export type DiffMode = 'unified' | 'split';
export type AppTheme = string;

export const BUILTIN_THEMES = ['dark', 'light', 'one-dark-pro', 'claude', 'classic-dark'] as const;

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
  /** LSP InitializeParams.initializationOptions (any JSON). */
  initializationOptions?: unknown;
}

/** Extension claimed by multiple language servers (last registration wins). */
export interface LspExtensionConflict {
  extension: string;
  winnerLanguageId: string;
  displacedLanguageIds: string[];
}

/** 补全接受时是否自动应用附加编辑（自动导入），默认 `'auto'`。 */
export type LspImportStrategy = 'auto' | 'ask' | 'never';

export interface LspConfig {
  /** Default auto-start for built-in servers. */
  autoStart: LspAutoStart;
  /** Minutes after leaving a project before stopping its LSP sessions. */
  deactivateStopMinutes: number;
  customServers: CustomLspServerConfig[];
  /**
   * 补全接受时附加编辑（自动导入）的应用策略（M4 / R4）。
   *
   * `auto` 放行（现状行为）/ `ask` 有编辑时弹确认 / `never` 只插入标识符。
   * 纯前端策略，后端只做持久化透传（`LspSettings.import_strategy`）。
   */
  importStrategy: LspImportStrategy;
}

/**
 * `dap.*` 配置段。
 *
 * 注意：`javaBackend` 的**权威读取点在后端**（每次调试动作实时读取）；前端读取同一键
 * 只用于 dispatch（决定是否发起 B' 探测、以及是否跳过 host-jar 门控）。
 */
export interface DapConfig {
  /** Java 调试后端：`auto`（默认，B' 优先）/ `jdtls`（只用 B'）/ `host`（只用自写 host）。 */
  javaBackend?: JavaDebugBackend;
}

/** Java 调试后端选择。 */
export type JavaDebugBackend = 'auto' | 'jdtls' | 'host';

export interface AppConfig {
  theme: AppTheme;
  appearanceFontSize: number;
  editorFontSize: number;
  terminalFontSize: number;
  diffMode: DiffMode;
  shell: string;
  /** @deprecated 旧字段，保留兼容读取，写入时同步 monoFontFamily */
  fontFamily: string;
  /** 新：mono 角色字体（终端+编辑器+全部 font-mono），替代 fontFamily */
  monoFontFamily?: string;
  /** 预留：UI 角色字体，本期不暴露 UI */
  uiFontFamily?: string;
  customIdes: { name: string; command: string }[];
  ideCommandOverrides: Record<string, string>;
  /** 内置 agent 的 command 覆盖（旧字段，已由 `agentOverrides` 取代，保留兼容读取）。 */
  agentCommandOverrides: Record<string, string>;
  /** 内置 agent 完整字段覆盖（id → 覆盖后的 AgentConfig；reset = 删除条目恢复出厂）。 */
  agentOverrides?: Record<string, AgentConfig>;
  customAgents: AgentConfig[];
  agentSelectorShowPresetBar: boolean;
  agentSelectorCompactMode: boolean;
  hiddenAgentIds: string[];
  shortcuts: Record<string, string>;
  terminalGpuAcceleration: boolean;
  enablePiThemeSync: boolean;
  enableOpenCodeThemeSync: boolean;
  /** 是否允许从 View 菜单打开 DevTools（release 构建需启用 devtools feature）。 */
  enableDevTools: boolean;
  /** 切换 file tab 时自动在文件树中定位该文件。 */
  autoLocateFileOnTabSwitch: boolean;
  /** Language server settings (profile soft-warm, custom servers, idle recycle). */
  lsp: LspConfig;
  /** Project-id → favorite branch names, persisted across sessions. */
  favoriteBranches: Record<string, string[]>;
  /** Debug Adapter Protocol 配置（Java 后端选择等）。 */
  dap?: DapConfig;
  /** AI 文档翻译默认项（工具条选择器以此初始化）。 */
  translation?: {
    agentId?: string;
    modelId?: string;
    targetLanguage?: string;
  };
}

/**
 * `config.json` 的**纯解析层**：磁盘 JSON → 规范化 `AppConfig`。
 *
 * ## 为什么单独一个模块
 *
 * 「磁盘上的任意 JSON 如何变成可用的 `AppConfig`」是一组**纯函数**（零副作用、无 React），
 * 与「何时读取、读后如何触发主题重载」这类**副作用编排**是两件事。放在 hook 文件里时，
 * 二者混在同一个 360 行的文件中，且纯函数部分**无法直测**（要起 `renderHook` 才能触达）。
 * 抽出后：解析可 tempdir 级直测，hook 只管编排。
 *
 * ## 与「未建模键」契约的关系（2026-10-16）
 *
 * `config.json` 是**多域共享**的文件（`notification` / `agentHookSources` /
 * `projectOnboarding` 等键由其它域写入），而 `save_config` 是**整份覆盖**而非补丁。
 * 因此本模块的产出必须**原样携带**它不认识的键 —— 否则一次「设置页改个字号」就会把
 * 其它域的键静默删除。实现方式是把磁盘对象铺在最前、已建模字段逐个覆盖，
 * 从而对**将来任何新键**自动免疫（无需维护「已建模键」清单，那清单本身就是下一个漏项）。
 */

import { parseImportStrategy } from '@/features/lsp/api/lspImportStrategy';
import type {
  AppConfig,
  LspAutoStart,
  LspConfig,
  CustomLspServerConfig,
} from '@/features/settings/types';
import { BUILTIN_THEMES } from '@/features/settings/types';
import type { CommentDisplayMode } from '@/shared/types/settings';

/** 应用默认配置（也是「磁盘缺字段」时的回落基准）。 */
export const DEFAULT_CONFIG: AppConfig = {
  theme: 'dark',
  appearanceFontSize: 12,
  editorFontSize: 14,
  terminalFontSize: 14,
  diffMode: 'unified',
  shell: '',
  fontFamily: '',
  monoFontFamily: '',
  uiFontFamily: '',
  customIdes: [],
  ideCommandOverrides: {},
  customAgents: [],
  agentSelectorShowPresetBar: true,
  agentSelectorCompactMode: false,
  hiddenAgentIds: [],
  shortcuts: {},
  terminalGpuAcceleration: false,
  enablePiThemeSync: false,
  enableOpenCodeThemeSync: false,
  enableDevTools: false,
  autoLocateFileOnTabSwitch: true,
  editorGitChangeHighlight: true,
  watcherExclude: [],
  lsp: {
    autoStart: 'onFirstFile',
    deactivateStopMinutes: 30,
    customServers: [],
    importStrategy: 'auto',
  },
  favoriteBranches: {},
};

/** 磁盘 JSON 的宽松视图（含已废弃的旧字段与未知键）。 */
type PartialLoadedConfig = Partial<AppConfig> & {
  fontSize?: number;
  theme?: unknown;
  lsp?: Partial<LspConfig> & { customServers?: unknown };
};

/** 是否内置主题（`BUILTIN_THEMES` 是唯一事实源）。 */
export function isBuiltinTheme(theme: string): boolean {
  return (BUILTIN_THEMES as readonly string[]).includes(theme);
}

function parseAutoStart(v: unknown): LspAutoStart {
  if (v === 'onProjectSelect' || v === 'manual' || v === 'onFirstFile') return v;
  return 'onFirstFile';
}

/** 规范化 `lsp` 块：缺字段 / 非法值一律回落默认（老 config.json 向后兼容）。 */
export function mergeLspConfig(raw: unknown): LspConfig {
  const base = DEFAULT_CONFIG.lsp;
  if (!raw || typeof raw !== 'object') return { ...base, customServers: [] };
  const o = raw as Record<string, unknown>;
  const servers: CustomLspServerConfig[] = Array.isArray(o.customServers)
    ? (o.customServers as CustomLspServerConfig[]).filter(
        (s) =>
          s &&
          typeof s === 'object' &&
          typeof s.languageId === 'string' &&
          Array.isArray(s.command) &&
          Array.isArray(s.file_extensions),
      )
    : [];
  return {
    autoStart: parseAutoStart(o.autoStart),
    deactivateStopMinutes:
      typeof o.deactivateStopMinutes === 'number' && o.deactivateStopMinutes > 0
        ? Math.floor(o.deactivateStopMinutes)
        : base.deactivateStopMinutes,
    customServers: servers,
    importStrategy: parseImportStrategy(o.importStrategy),
  };
}

/** 从磁盘 JSON 规范化出的 `AppConfig` + 需要副作用编排方处理的主题信息。 */
export interface LoadedAppConfig {
  /** 规范化后的配置（**已携带磁盘上未建模的键**，见模块头）。 */
  config: AppConfig;
  /** 主题名（非内置时调用方需异步加载其 CSS 变量）。 */
  theme: string;
  /** `theme` 非内置主题时为 true（调用方据此触发 `loadCustomThemeVars`）。 */
  needsCustomThemeVars: boolean;
}

/** `saveConfig` 接受的两种入参（见 `useAppConfigOwner.saveConfig` 的文档）。 */

export function normalizeLoadedConfig(loaded: unknown): LoadedAppConfig {
  const saved: PartialLoadedConfig =
    typeof loaded === 'object' && loaded !== null ? (loaded as PartialLoadedConfig) : {};

  const theme = typeof saved.theme === 'string' ? saved.theme : 'dark';

  // 迁移：旧 `fontSize` → 新 `terminalFontSize`（幂等，仅在新键缺失时生效）。
  const rawTerminalFontSize =
    typeof saved.terminalFontSize === 'number'
      ? saved.terminalFontSize
      : typeof saved.fontSize === 'number'
        ? saved.fontSize
        : DEFAULT_CONFIG.terminalFontSize;

  // 迁移：旧 fontFamily → 新 monoFontFamily（幂等，读旧写新）。
  const rawMono =
    typeof (saved as { monoFontFamily?: unknown }).monoFontFamily === 'string'
      ? (saved as { monoFontFamily: string }).monoFontFamily
      : typeof saved.fontFamily === 'string'
        ? saved.fontFamily
        : (DEFAULT_CONFIG.monoFontFamily ?? '');
  const rawUi =
    typeof (saved as { uiFontFamily?: unknown }).uiFontFamily === 'string'
      ? (saved as { uiFontFamily: string }).uiFontFamily
      : (DEFAULT_CONFIG.uiFontFamily ?? '');

  // 先把磁盘原样铺开（保住未建模键），再让下面已建模的字段覆盖它。
  const config: AppConfig = {
    ...(saved as Partial<AppConfig>),
    theme: theme as AppConfig['theme'],
    appearanceFontSize:
      typeof saved.appearanceFontSize === 'number'
        ? saved.appearanceFontSize
        : DEFAULT_CONFIG.appearanceFontSize,
    editorFontSize:
      typeof saved.editorFontSize === 'number'
        ? saved.editorFontSize
        : DEFAULT_CONFIG.editorFontSize,
    terminalFontSize: rawTerminalFontSize,
    diffMode: saved.diffMode === 'split' ? 'split' : 'unified',
    shell: typeof saved.shell === 'string' ? saved.shell : DEFAULT_CONFIG.shell,
    fontFamily: typeof saved.fontFamily === 'string' ? saved.fontFamily : DEFAULT_CONFIG.fontFamily,
    monoFontFamily: rawMono,
    uiFontFamily: rawUi,
    customIdes: Array.isArray(saved.customIdes) ? saved.customIdes : DEFAULT_CONFIG.customIdes,
    ideCommandOverrides:
      saved.ideCommandOverrides && typeof saved.ideCommandOverrides === 'object'
        ? saved.ideCommandOverrides
        : DEFAULT_CONFIG.ideCommandOverrides,
    customAgents: Array.isArray(saved.customAgents)
      ? saved.customAgents
      : DEFAULT_CONFIG.customAgents,
    agentSelectorShowPresetBar:
      typeof saved.agentSelectorShowPresetBar === 'boolean'
        ? saved.agentSelectorShowPresetBar
        : DEFAULT_CONFIG.agentSelectorShowPresetBar,
    agentSelectorCompactMode:
      typeof saved.agentSelectorCompactMode === 'boolean'
        ? saved.agentSelectorCompactMode
        : DEFAULT_CONFIG.agentSelectorCompactMode,
    hiddenAgentIds: Array.isArray(saved.hiddenAgentIds)
      ? saved.hiddenAgentIds.filter((id): id is string => typeof id === 'string')
      : DEFAULT_CONFIG.hiddenAgentIds,
    shortcuts:
      saved.shortcuts && typeof saved.shortcuts === 'object'
        ? saved.shortcuts
        : DEFAULT_CONFIG.shortcuts,
    terminalGpuAcceleration:
      typeof saved.terminalGpuAcceleration === 'boolean'
        ? saved.terminalGpuAcceleration
        : DEFAULT_CONFIG.terminalGpuAcceleration,
    enablePiThemeSync:
      typeof saved.enablePiThemeSync === 'boolean'
        ? saved.enablePiThemeSync
        : DEFAULT_CONFIG.enablePiThemeSync,
    enableOpenCodeThemeSync:
      typeof saved.enableOpenCodeThemeSync === 'boolean'
        ? saved.enableOpenCodeThemeSync
        : DEFAULT_CONFIG.enableOpenCodeThemeSync,
    enableDevTools:
      typeof saved.enableDevTools === 'boolean'
        ? saved.enableDevTools
        : DEFAULT_CONFIG.enableDevTools,
    autoLocateFileOnTabSwitch:
      typeof saved.autoLocateFileOnTabSwitch === 'boolean'
        ? saved.autoLocateFileOnTabSwitch
        : DEFAULT_CONFIG.autoLocateFileOnTabSwitch,
    editorGitChangeHighlight:
      typeof saved.editorGitChangeHighlight === 'boolean'
        ? saved.editorGitChangeHighlight
        : DEFAULT_CONFIG.editorGitChangeHighlight,
    watcherExclude: Array.isArray(saved.watcherExclude)
      ? saved.watcherExclude.filter((p): p is string => typeof p === 'string')
      : (DEFAULT_CONFIG.watcherExclude ?? []),
    lsp: mergeLspConfig(saved.lsp),
    favoriteBranches:
      saved.favoriteBranches && typeof saved.favoriteBranches === 'object'
        ? saved.favoriteBranches
        : DEFAULT_CONFIG.favoriteBranches,
    translation:
      saved.translation && typeof saved.translation === 'object'
        ? {
            ...saved.translation,
            commentMode: normalizeCommentMode(saved.translation.commentMode),
            commentAutoWarm:
              typeof saved.translation.commentAutoWarm === 'boolean'
                ? saved.translation.commentAutoWarm
                : undefined,
          }
        : undefined,
  };

  return { config, theme, needsCustomThemeVars: !isBuiltinTheme(theme) };
}

/** 注释显示模式的合法取值（非法值丢弃，读到旧配置时不炸）。 */
const COMMENT_MODES = ['below', 'inline', 'hover', 'off'] as const;

/** 校验注释显示模式；非法 / 缺省 → `undefined`（由消费方兜底默认值）。 */
function normalizeCommentMode(value: unknown): CommentDisplayMode | undefined {
  return typeof value === 'string' && (COMMENT_MODES as readonly string[]).includes(value)
    ? (value as CommentDisplayMode)
    : undefined;
}

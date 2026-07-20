import { useState, useEffect, useCallback, useRef } from "react";
import {
  saveConfig as saveConfigApi,
  loadConfig as loadConfigApi,
  syncAgentTheme,
  listCustomThemes,
  getCustomTheme,
} from "../api/settingsApi";
import type {
  AppConfig,
  ThemeListItem,
  CustomThemeData,
  LspConfig,
  CustomLspServerConfig,
  LspAutoStart,
} from '@/features/settings/types';
import { BUILTIN_THEMES } from '@/features/settings/types';
import { updateAllTerminalThemes } from '@/features/terminal';
import { useProjectStore } from '@/features/project/store';
import { useConnectionStore } from '@/features/connection/store';
import { buildFontFamily } from '@/shared/utils/terminal';

const DEFAULT_CONFIG: AppConfig = {
   theme: "dark",
   appearanceFontSize: 12,
   editorFontSize: 14,
   terminalFontSize: 14,
   diffMode: "unified",
   shell: "",
   fontFamily: "",
   customIdes: [],
   ideCommandOverrides: {},
   agentCommandOverrides: {},
   agentSkillPathOverrides: {},
   customAgents: [],
   agentSelectorShowPresetBar: true,
   agentSelectorCompactMode: false,
   hiddenAgentIds: [],
   shortcuts: {},
   terminalGpuAcceleration: false,
   enablePiThemeSync: false,
   enableOpenCodeThemeSync: false,
   lsp: {
      autoStart: "onFirstFile",
      deactivateStopMinutes: 30,
      customServers: [],
   },
};

type PartialLoadedConfig = Partial<AppConfig> & {
   fontSize?: number;
   theme?: unknown;
   lsp?: Partial<LspConfig> & { customServers?: unknown };
};

function parseAutoStart(v: unknown): LspAutoStart {
  if (v === 'onProjectSelect' || v === 'manual' || v === 'onFirstFile') return v;
  return 'onFirstFile';
}

function mergeLspConfig(raw: unknown): LspConfig {
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
  };
}

function isBuiltinTheme(theme: string): boolean {
  return (BUILTIN_THEMES as readonly string[]).includes(theme);
}

const CUSTOM_CSS_VARS = [
  "bg-primary", "bg-secondary", "bg-tertiary", "bg-hover", "bg-selected",
  "bg-gradient-start", "bg-gradient-end",
  "text-primary", "text-secondary", "text-muted",
  "border-color", "terminal-selection",
  "titlebar-gradient-start",
  "accent-blue", "accent-blue-rgb", "accent-green", "accent-yellow", "accent-red",
  "text-on-accent",
  "status-idle", "status-running", "status-failed",
  "diff-added", "diff-removed", "diff-added-text", "diff-removed-text",
];

let _previousCustomVars: string[] | null = null;

function applyCustomCssVars(variables: Record<string, string>) {
  if (_previousCustomVars) {
    for (const name of _previousCustomVars) {
      document.documentElement.style.removeProperty(`--${name}`);
    }
  }
  const applied: string[] = [];
  for (const name of CUSTOM_CSS_VARS) {
    const val = variables[name];
    if (val !== undefined) {
      document.documentElement.style.setProperty(`--${name}`, val);
      applied.push(name);
    }
  }
  _previousCustomVars = applied;
}

function clearCustomCssVars() {
  if (_previousCustomVars) {
    for (const name of _previousCustomVars) {
      document.documentElement.style.removeProperty(`--${name}`);
    }
    _previousCustomVars = null;
  }
}

export function useAppConfig() {
   const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
   const [customThemes, setCustomThemes] = useState<ThemeListItem[]>([]);
   const themeDataCache = useRef<Map<string, CustomThemeData>>(new Map());

   useEffect(() => {
      document.documentElement.style.setProperty(
         "--font-size",
         `${config.appearanceFontSize}px`,
      );
   }, [config.appearanceFontSize]);

   useEffect(() => {
      document.documentElement.style.setProperty(
         "--terminal-font-size",
         `${config.terminalFontSize}px`,
      );
   }, [config.terminalFontSize]);

   useEffect(() => {
      // Keep Debug Console / other terminal-styled panes on the same stack as xterm.
      document.documentElement.style.setProperty(
         "--terminal-font-family",
         buildFontFamily(config.fontFamily ?? ""),
      );
   }, [config.fontFamily]);

   useEffect(() => {
      document.documentElement.setAttribute("data-theme", config.theme);

      if (isBuiltinTheme(config.theme)) {
        clearCustomCssVars();
      } else {
        const cached = themeDataCache.current.get(config.theme);
        if (cached) {
          applyCustomCssVars(cached.variables);
        }
      }

      requestAnimationFrame(() => {
         updateAllTerminalThemes();
      });

      const { projects } = useProjectStore.getState();
      const { wslEntries } = useConnectionStore.getState();
      const localPaths = projects.map((p) => p.path);
      const wsl = wslEntries.flatMap((e) =>
         e.projects.map((p) => ({ distro: e.distro, path: p.path })),
      );
      if (localPaths.length > 0 || wsl.length > 0) {
         syncAgentTheme(config.theme, { local_paths: localPaths, wsl }).catch((e) => {
            console.error("[App] Failed to sync agent theme:", e);
         });
      }
   }, [config.theme]);

   const loadCustomThemeVars = useCallback(async (themeName: string) => {
     if (themeDataCache.current.has(themeName)) return;
     try {
       const data = await getCustomTheme(themeName);
       if (data) {
         themeDataCache.current.set(themeName, data);
         if (config.theme === themeName) {
           applyCustomCssVars(data.variables);
         }
       }
     } catch (e) {
       console.error(`[App] Failed to load custom theme "${themeName}":`, e);
     }
   }, [config.theme]);

   const saveConfig = useCallback(async (next: AppConfig) => {
      // Always normalize global lsp block so it is part of config.json
      const normalized: AppConfig = {
         ...next,
         lsp: mergeLspConfig(next.lsp),
      };
      setConfig(normalized);
      if (!isBuiltinTheme(normalized.theme)) {
        await loadCustomThemeVars(normalized.theme);
      }
      try {
         // Persists entire AppConfig (including lsp) to ~/.neeko/config.json
         // Backend save_config also applies config.lsp to the live LSP registry.
         await saveConfigApi(normalized as unknown as Record<string, unknown>);
      } catch (e) {
         console.error("[App] Failed to save config:", e);
         throw e;
      }
   }, [loadCustomThemeVars]);

   useEffect(() => {
      (async () => {
         try {
            const loaded = await listCustomThemes();
            setCustomThemes(loaded);
         } catch (e) {
            console.error("[App] Failed to load custom themes:", e);
         }
      })();
   }, []);

   useEffect(() => {
      (async () => {
         try {
            const loaded = await loadConfigApi();
            if (loaded && typeof loaded === "object") {
               const saved = loaded as PartialLoadedConfig;

               if (typeof saved.fontSize === "number" && typeof saved.terminalFontSize !== "number") {
                  saved.terminalFontSize = saved.fontSize;
               }

               const theme =
                  typeof saved.theme === "string" ? saved.theme : "dark";

               if (!isBuiltinTheme(theme)) {
                 await loadCustomThemeVars(theme);
               }

               setConfig({
                  theme,
                  appearanceFontSize:
                     typeof saved.appearanceFontSize === "number"
                        ? saved.appearanceFontSize
                        : DEFAULT_CONFIG.appearanceFontSize,
                  editorFontSize:
                     typeof saved.editorFontSize === "number"
                        ? saved.editorFontSize
                        : DEFAULT_CONFIG.editorFontSize,
                  terminalFontSize:
                     typeof saved.terminalFontSize === "number"
                        ? saved.terminalFontSize
                        : DEFAULT_CONFIG.terminalFontSize,
                  diffMode: saved.diffMode === "split" ? "split" : "unified",
                  shell:
                     typeof saved.shell === "string"
                        ? saved.shell
                        : DEFAULT_CONFIG.shell,
                  fontFamily:
                     typeof saved.fontFamily === "string"
                        ? saved.fontFamily
                        : DEFAULT_CONFIG.fontFamily,
                  customIdes: Array.isArray(saved.customIdes)
                     ? saved.customIdes
                     : DEFAULT_CONFIG.customIdes,
                  ideCommandOverrides:
                     saved.ideCommandOverrides &&
                        typeof saved.ideCommandOverrides === "object"
                        ? saved.ideCommandOverrides
                        : DEFAULT_CONFIG.ideCommandOverrides,
                  agentCommandOverrides:
                     saved.agentCommandOverrides &&
                        typeof saved.agentCommandOverrides === "object"
                        ? saved.agentCommandOverrides
                        : DEFAULT_CONFIG.agentCommandOverrides,
                  agentSkillPathOverrides:
                     saved.agentSkillPathOverrides &&
                        typeof saved.agentSkillPathOverrides === "object"
                        ? saved.agentSkillPathOverrides
                        : DEFAULT_CONFIG.agentSkillPathOverrides,
                  customAgents: Array.isArray(saved.customAgents)
                     ? saved.customAgents
                     : DEFAULT_CONFIG.customAgents,
                  agentSelectorShowPresetBar:
                     typeof saved.agentSelectorShowPresetBar === "boolean"
                        ? saved.agentSelectorShowPresetBar
                        : DEFAULT_CONFIG.agentSelectorShowPresetBar,
                  agentSelectorCompactMode:
                     typeof saved.agentSelectorCompactMode === "boolean"
                        ? saved.agentSelectorCompactMode
                        : DEFAULT_CONFIG.agentSelectorCompactMode,
                  hiddenAgentIds: Array.isArray(saved.hiddenAgentIds)
                     ? saved.hiddenAgentIds.filter((id: unknown) => typeof id === "string")
                     : DEFAULT_CONFIG.hiddenAgentIds,
                  shortcuts:
                     saved.shortcuts && typeof saved.shortcuts === "object"
                        ? saved.shortcuts
                        : DEFAULT_CONFIG.shortcuts,
                  terminalGpuAcceleration:
                     typeof saved.terminalGpuAcceleration === "boolean"
                        ? saved.terminalGpuAcceleration
                        : DEFAULT_CONFIG.terminalGpuAcceleration,
                   enablePiThemeSync:
                      typeof saved.enablePiThemeSync === "boolean"
                         ? saved.enablePiThemeSync
                         : DEFAULT_CONFIG.enablePiThemeSync,
                   enableOpenCodeThemeSync:
                      typeof saved.enableOpenCodeThemeSync === "boolean"
                         ? saved.enableOpenCodeThemeSync
                         : DEFAULT_CONFIG.enableOpenCodeThemeSync,
                  lsp: mergeLspConfig(saved.lsp),
               });
            }
         } catch (e) {
            console.error("[App] Failed to load config:", e);
         }
      })();
   }, [loadCustomThemeVars]);

   return { config, saveConfig, customThemes };
}

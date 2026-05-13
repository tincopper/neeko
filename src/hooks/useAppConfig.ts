import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppConfig } from "../types";
import { updateAllTerminalThemes } from "../components/terminal";
import { useAppStore } from "../store/appStore";

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
};


type PartialLoadedConfig = Partial<AppConfig> & {
   fontSize?: number;
   theme?: unknown;
};
export function useAppConfig() {
   const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);

   // 同步 UI 字体大小到 CSS 变量 --font-size（由 appearanceFontSize 驱动）
   useEffect(() => {
      document.documentElement.style.setProperty(
         "--font-size",
         `${config.appearanceFontSize}px`,
      );
   }, [config.appearanceFontSize]);

   // 同步终端字体大小到 CSS 变量 --terminal-font-size
   useEffect(() => {
      document.documentElement.style.setProperty(
         "--terminal-font-size",
         `${config.terminalFontSize}px`,
      );
   }, [config.terminalFontSize]);

   // 同步主题到 data-theme 属性，并更新 OpenCode tui.json
   useEffect(() => {
      document.documentElement.setAttribute("data-theme", config.theme);
      requestAnimationFrame(() => {
         updateAllTerminalThemes();
      });

      // 同步所有项目的 OpenCode tui.json 主题配置
      const { projects, wslEntries } = useAppStore.getState();
      const localPaths = projects.map((p) => p.path);
      const wsl = wslEntries.flatMap((e) =>
         e.projects.map((p) => ({ distro: e.distro, path: p.path })),
      );
      if (localPaths.length > 0 || wsl.length > 0) {
         invoke("sync_opencode_theme", {
            theme: config.theme,
            targets: { local_paths: localPaths, wsl },
         }).catch((e) => {
            console.error("[App] Failed to sync OpenCode theme:", e);
         });
      }
   }, [config.theme]);

   // 持久化保存配置
   const saveConfig = useCallback(async (next: AppConfig) => {
      setConfig(prev => {
         // 浅比较：所有字段相同则返回旧引用，避免不必要的重渲染
         if (
            prev.theme === next.theme &&
            prev.appearanceFontSize === next.appearanceFontSize &&
            prev.editorFontSize === next.editorFontSize &&
            prev.terminalFontSize === next.terminalFontSize &&
            prev.diffMode === next.diffMode &&
            prev.shell === next.shell &&
            prev.fontFamily === next.fontFamily &&
            prev.customIdes === next.customIdes &&
            prev.ideCommandOverrides === next.ideCommandOverrides &&
            prev.agentCommandOverrides === next.agentCommandOverrides &&
            prev.agentSkillPathOverrides === next.agentSkillPathOverrides &&
            prev.customAgents === next.customAgents &&
            prev.agentSelectorShowPresetBar === next.agentSelectorShowPresetBar &&
            prev.agentSelectorCompactMode === next.agentSelectorCompactMode &&
            prev.hiddenAgentIds === next.hiddenAgentIds &&
            prev.shortcuts === next.shortcuts
         ) return prev;
         return next;
      });
      try {
         await invoke("save_config", { config: next });
      } catch (e) {
         console.error("[App] Failed to save config:", e);
      }
   }, []);

   // 应用启动时加载配置
   useEffect(() => {
      (async () => {
         try {
            const loaded = await invoke<unknown>("load_config");
            if (loaded && typeof loaded === "object") {
               const saved = loaded as PartialLoadedConfig;
               if (typeof saved.fontSize === "number" && typeof saved.terminalFontSize !== "number") {
                  saved.terminalFontSize = saved.fontSize;
               }

               const theme =
                  saved.theme === "light" || saved.theme === "one-dark-pro" || saved.theme === "claude"
                     ? saved.theme
                     : "dark";

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
               });
            }
         } catch (e) {
            console.error("[App] Failed to load config:", e);
         }
      })();
   }, []);

   return { config, saveConfig };
}

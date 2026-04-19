import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppConfig } from "../types";

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
};

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  // 同步主题到 data-theme 属性
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", config.theme);
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
        prev.hiddenAgentIds === next.hiddenAgentIds
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
        const saved = await invoke<AppConfig>("load_config");
        if (saved && typeof saved === "object") {
          // 迁移旧配置：fontSize → terminalFontSize
          const savedAny = saved as any;
          if (typeof savedAny.fontSize === "number") {
            if (typeof savedAny.terminalFontSize !== "number") {
              savedAny.terminalFontSize = savedAny.fontSize;
            }
            delete savedAny.fontSize;
          }

          setConfig({
            theme: (["light", "one-dark-pro", "claude"] as const).includes((saved as any).theme)
                ? (saved as any).theme
                : "dark",
            appearanceFontSize:
              typeof savedAny.appearanceFontSize === "number"
                ? savedAny.appearanceFontSize
                : DEFAULT_CONFIG.appearanceFontSize,
            editorFontSize:
              typeof savedAny.editorFontSize === "number"
                ? savedAny.editorFontSize
                : DEFAULT_CONFIG.editorFontSize,
            terminalFontSize:
              typeof savedAny.terminalFontSize === "number"
                ? savedAny.terminalFontSize
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
          });
        }
      } catch (e) {
        console.error("[App] Failed to load config:", e);
      }
    })();
  }, []);

  return { config, settingsOpen, setSettingsOpen, saveConfig };
}

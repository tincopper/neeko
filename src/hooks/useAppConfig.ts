import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppConfig } from "../types";

const DEFAULT_CONFIG: AppConfig = {
  fontSize: 14,
  diffMode: "unified",
  shell: "",
  fontFamily: "",
  customIdes: [],
  ideCommandOverrides: {},
  agentCommandOverrides: {},
  customAgents: [],
};

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 同步字体大小到 CSS 变量
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--font-size",
      `${config.fontSize}px`,
    );
  }, [config.fontSize]);

  // 持久化保存配置
  const saveConfig = useCallback(async (next: AppConfig) => {
    setConfig(prev => {
      // 浅比较：所有字段相同则返回旧引用，避免不必要的重渲染
      if (
        prev.fontSize === next.fontSize &&
        prev.diffMode === next.diffMode &&
        prev.shell === next.shell &&
        prev.fontFamily === next.fontFamily &&
        prev.customIdes === next.customIdes &&
        prev.ideCommandOverrides === next.ideCommandOverrides &&
        prev.agentCommandOverrides === next.agentCommandOverrides &&
        prev.customAgents === next.customAgents
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
        const saved = await invoke<Record<string, any>>("load_config");
        if (saved && typeof saved === "object") {
          setConfig({
            fontSize:
              typeof saved.fontSize === "number"
                ? saved.fontSize
                : DEFAULT_CONFIG.fontSize,
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
            customAgents: Array.isArray(saved.customAgents)
              ? saved.customAgents
              : DEFAULT_CONFIG.customAgents,
          });
        }
      } catch (e) {
        console.error("[App] Failed to load config:", e);
      }
    })();
  }, []);

  return { config, settingsOpen, setSettingsOpen, saveConfig };
}

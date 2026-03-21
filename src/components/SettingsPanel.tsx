import React, { useEffect, useRef } from "react";

export type DiffMode = "unified" | "split";

export interface AppConfig {
  fontSize: number;
  diffMode: DiffMode;
}

interface SettingsPanelProps {
  config: AppConfig;
  onConfigChange: (next: AppConfig) => void;
  onClose: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ config, onConfigChange, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);

  // 点击面板外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const setFontSize = (size: number) => {
    onConfigChange({ ...config, fontSize: Math.min(24, Math.max(10, size)) });
  };

  const setDiffMode = (diffMode: DiffMode) => {
    onConfigChange({ ...config, diffMode });
  };

  return (
    <div className="settings-panel" ref={panelRef}>
      <div className="settings-header">
        <span className="settings-title">Settings</span>
        <button className="settings-close-btn" onClick={onClose}>✕</button>
      </div>

      <div className="settings-section">
        <div className="settings-label">Font Size</div>
        <div className="settings-row">
          <button
            className="settings-step-btn"
            onClick={() => setFontSize(config.fontSize - 1)}
            disabled={config.fontSize <= 10}
          >−</button>
          <span className="settings-value">{config.fontSize}px</span>
          <button
            className="settings-step-btn"
            onClick={() => setFontSize(config.fontSize + 1)}
            disabled={config.fontSize >= 24}
          >+</button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">Diff View Mode</div>
        <div className="settings-toggle-row">
          <button
            className={`settings-toggle-btn${config.diffMode === "unified" ? " active" : ""}`}
            onClick={() => setDiffMode("unified")}
          >Unified</button>
          <button
            className={`settings-toggle-btn${config.diffMode === "split" ? " active" : ""}`}
            onClick={() => setDiffMode("split")}
          >Split</button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;

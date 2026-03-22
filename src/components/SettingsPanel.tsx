import React, { useEffect, useRef, useState } from "react";

export type DiffMode = "unified" | "split";

export interface AppConfig {
  fontSize: number;
  diffMode: DiffMode;
  shell: string;
}

// 各平台预设 shell 列表
export const PRESET_SHELLS: { label: string; value: string }[] = (
  navigator.platform.toLowerCase().includes("win")
    ? [
        { label: "PowerShell",      value: "powershell.exe" },
        { label: "Command Prompt",  value: "cmd.exe" },
        { label: "Git Bash",        value: "C:\\Program Files\\Git\\bin\\bash.exe" },
        { label: "WSL (bash)",      value: "wsl.exe" },
      ]
    : [
        { label: "Default ($SHELL)", value: "" },
        { label: "bash",             value: "/bin/bash" },
        { label: "zsh",              value: "/bin/zsh" },
        { label: "fish",             value: "/usr/bin/fish" },
        { label: "sh",               value: "/bin/sh" },
      ]
);

interface SettingsPanelProps {
  config: AppConfig;
  onConfigChange: (next: AppConfig) => void;
  onClose: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ config, onConfigChange, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  // shell 输入框的本地值（允许手动输入自定义路径）
  const [shellInput, setShellInput] = useState(config.shell);

  useEffect(() => {
    setShellInput(config.shell);
  }, [config.shell]);

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

  const applyShell = (value: string) => {
    setShellInput(value);
    onConfigChange({ ...config, shell: value });
  };

  // 判断当前 shell 值是否匹配某个预设
  const isCustomShell = shellInput !== "" && !PRESET_SHELLS.some(s => s.value === shellInput);

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

      <div className="settings-section">
        <div className="settings-label">Terminal Shell</div>
        <div className="settings-shell-presets">
          {PRESET_SHELLS.map(({ label, value }) => (
            <button
              key={value}
              className={`settings-shell-btn${shellInput === value ? " active" : ""}`}
              onClick={() => applyShell(value)}
              title={value || "Use $SHELL environment variable"}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="settings-shell-custom">
          <input
            className={`settings-shell-input${isCustomShell ? " custom-active" : ""}`}
            type="text"
            placeholder="Custom path, e.g. /usr/bin/zsh"
            value={shellInput}
            onChange={e => setShellInput(e.target.value)}
            onBlur={e => applyShell(e.target.value.trim())}
            onKeyDown={e => { if (e.key === "Enter") applyShell(shellInput.trim()); }}
            spellCheck={false}
          />
        </div>
        <div className="settings-shell-hint">
          Takes effect on next terminal session
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;

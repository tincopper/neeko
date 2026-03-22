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
        { label: "PowerShell",     value: "powershell.exe" },
        { label: "Command Prompt", value: "cmd.exe" },
        { label: "Git Bash",       value: "C:\\Program Files\\Git\\bin\\bash.exe" },
        { label: "WSL (bash)",     value: "wsl.exe" },
      ]
    : [
        { label: "Default ($SHELL)", value: "" },
        { label: "bash",             value: "/bin/bash" },
        { label: "zsh",              value: "/bin/zsh" },
        { label: "fish",             value: "/usr/bin/fish" },
        { label: "sh",               value: "/bin/sh" },
      ]
);

type NavCategory = "editor" | "terminal" | "git";

interface NavItem {
  id: NavCategory;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "editor",
    label: "Editor",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 2.5A.5.5 0 0 1 2.5 2h11a.5.5 0 0 1 0 1h-11A.5.5 0 0 1 2 2.5Zm0 4A.5.5 0 0 1 2.5 6h11a.5.5 0 0 1 0 1h-11A.5.5 0 0 1 2 6.5Zm0 4a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5Z"/>
      </svg>
    ),
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M6 9a.5.5 0 0 1 .5-.5h3.793l-1.147-1.146a.5.5 0 0 1 .708-.708l2 2a.5.5 0 0 1 0 .708l-2 2a.5.5 0 0 1-.708-.708L10.293 9.5H6.5A.5.5 0 0 1 6 9Zm-2.354-4.854a.5.5 0 0 1 0 .708L2.707 6l.939.939a.5.5 0 1 1-.707.707l-1.25-1.25a.5.5 0 0 1 0-.707l1.25-1.25a.5.5 0 0 1 .707 0z"/>
        <path d="M0 3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3zm2-1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H2z"/>
      </svg>
    ),
  },
  {
    id: "git",
    label: "Git",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M15.698 7.287 8.712.302a1.03 1.03 0 0 0-1.457 0l-1.45 1.45 1.84 1.84a1.223 1.223 0 0 1 1.55 1.56l1.773 1.774a1.224 1.224 0 0 1 1.267 2.025 1.226 1.226 0 0 1-2.002-1.334L8.58 5.963v4.353a1.226 1.226 0 1 1-1.008-.036V5.887a1.226 1.226 0 0 1-.666-1.608L5.093 2.465l-4.79 4.79a1.03 1.03 0 0 0 0 1.457l6.986 6.986a1.03 1.03 0 0 0 1.457 0l6.953-6.953a1.031 1.031 0 0 0-.001-1.458z"/>
      </svg>
    ),
  },
];

interface SettingsPanelProps {
  config: AppConfig;
  onConfigChange: (next: AppConfig) => void;
  onClose: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ config, onConfigChange, onClose }) => {
  const [activeNav, setActiveNav] = useState<NavCategory>("editor");
  const [shellInput, setShellInput] = useState(config.shell);

  useEffect(() => { setShellInput(config.shell); }, [config.shell]);

  // Esc 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const setFontSize = (size: number) =>
    onConfigChange({ ...config, fontSize: Math.min(24, Math.max(10, size)) });

  const setDiffMode = (diffMode: DiffMode) =>
    onConfigChange({ ...config, diffMode });

  const applyShell = (value: string) => {
    setShellInput(value);
    onConfigChange({ ...config, shell: value });
  };

  const isCustomShell = shellInput !== "" && !PRESET_SHELLS.some(s => s.value === shellInput);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-dialog" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="settings-dialog-header">
          <span className="settings-dialog-title">Settings</span>
          <button className="settings-dialog-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="settings-dialog-body">
          {/* Left nav */}
          <nav className="settings-nav">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                className={`settings-nav-item${activeNav === item.id ? " active" : ""}`}
                onClick={() => setActiveNav(item.id)}
              >
                <span className="settings-nav-icon">{item.icon}</span>
                <span className="settings-nav-label">{item.label}</span>
              </button>
            ))}
          </nav>

          {/* Right content */}
          <div className="settings-content">
            {activeNav === "editor" && (
              <>
                <div className="settings-content-title">Editor</div>

                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-name">Font Size</div>
                    <div className="settings-item-desc">Terminal and UI font size in pixels</div>
                  </div>
                  <div className="settings-item-control">
                    <button
                      className="settings-step-btn"
                      onClick={() => setFontSize(config.fontSize - 1)}
                      disabled={config.fontSize <= 10}
                    >−</button>
                    <span className="settings-step-value">{config.fontSize}px</span>
                    <button
                      className="settings-step-btn"
                      onClick={() => setFontSize(config.fontSize + 1)}
                      disabled={config.fontSize >= 24}
                    >+</button>
                  </div>
                </div>

                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-name">Diff View Mode</div>
                    <div className="settings-item-desc">How file diffs are displayed</div>
                  </div>
                  <div className="settings-item-control">
                    <div className="settings-segmented">
                      <button
                        className={`settings-seg-btn${config.diffMode === "unified" ? " active" : ""}`}
                        onClick={() => setDiffMode("unified")}
                      >Unified</button>
                      <button
                        className={`settings-seg-btn${config.diffMode === "split" ? " active" : ""}`}
                        onClick={() => setDiffMode("split")}
                      >Split</button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {activeNav === "terminal" && (
              <>
                <div className="settings-content-title">Terminal</div>

                <div className="settings-item settings-item-col">
                  <div className="settings-item-info">
                    <div className="settings-item-name">Shell</div>
                    <div className="settings-item-desc">
                      Select a preset or enter a custom shell path.
                      Takes effect on the next terminal session.
                    </div>
                  </div>
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
              </>
            )}

            {activeNav === "git" && (
              <>
                <div className="settings-content-title">Git</div>
                <div className="settings-empty-section">
                  <svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor" opacity="0.3">
                    <path d="M15.698 7.287 8.712.302a1.03 1.03 0 0 0-1.457 0l-1.45 1.45 1.84 1.84a1.223 1.223 0 0 1 1.55 1.56l1.773 1.774a1.224 1.224 0 0 1 1.267 2.025 1.226 1.226 0 0 1-2.002-1.334L8.58 5.963v4.353a1.226 1.226 0 1 1-1.008-.036V5.887a1.226 1.226 0 0 1-.666-1.608L5.093 2.465l-4.79 4.79a1.03 1.03 0 0 0 0 1.457l6.986 6.986a1.03 1.03 0 0 0 1.457 0l6.953-6.953a1.031 1.031 0 0 0-.001-1.458z"/>
                  </svg>
                  <span>No Git settings yet</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;

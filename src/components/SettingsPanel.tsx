import React, { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IDE_PRESETS, getIdeCommand } from "../utils/idePresets";

export type DiffMode = "unified" | "split";

export interface AppConfig {
  fontSize: number;
  diffMode: DiffMode;
  shell: string;
  fontFamily: string;
  customIdes: { name: string; command: string }[];
  ideCommandOverrides: Record<string, string>; // preset id -> 自定义命令
}

// 内置等宽字体预设（系统通常包含其中之一）
export const BUILTIN_FONTS = [
  "JetBrains Mono",
  "Fira Code",
  "Cascadia Code",
  "Source Code Pro",
  "Consolas",
  "Monaco",
  "Menlo",
  "DejaVu Sans Mono",
  "Courier New",
];

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

type NavCategory = "editor" | "terminal" | "ide" | "git";

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
    id: "ide",
    label: "IDE",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h11A1.5 1.5 0 0 1 15 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 13.5v-11zm1.5-.5a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5h-11zM5.354 5.354a.5.5 0 1 0-.708-.708L2.793 6.5l1.853 1.854a.5.5 0 1 0 .708-.708L4.207 6.5l1.147-1.146zm5 0L11.5 6.5l-1.146 1.146a.5.5 0 0 0 .708.708L12.914 6.5l-1.853-1.854a.5.5 0 0 0-.707.708zM7.854 10.854a.5.5 0 0 1-.707-.707l1.5-3a.5.5 0 0 1 .906.42l-1.5 3a.5.5 0 0 1-.199.287z"/>
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

  // 字体相关状态
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [fontSearch, setFontSearch] = useState("");
  const [fontsLoading, setFontsLoading] = useState(false);
  const [fontListOpen, setFontListOpen] = useState(false);
  const fontDropdownRef = useRef<HTMLDivElement>(null);

  // 自定义 IDE 相关状态
  const [newIdeName, setNewIdeName] = useState("");
  const [newIdeCommand, setNewIdeCommand] = useState("");

  // 预设 IDE 双击编辑状态
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  useEffect(() => { setShellInput(config.shell); }, [config.shell]);

  // 切换到 Terminal 类目时加载系统字体
  const loadFonts = useCallback(async () => {
    if (systemFonts.length > 0) return;
    setFontsLoading(true);
    try {
      const fonts = await invoke<string[]>("get_system_fonts");
      setSystemFonts(fonts);
    } catch (e) {
      console.error("Failed to load system fonts:", e);
    } finally {
      setFontsLoading(false);
    }
  }, [systemFonts.length]);

  useEffect(() => {
    if (activeNav === "terminal") loadFonts();
  }, [activeNav, loadFonts]);

  // 点击字体下拉外部时关闭
  useEffect(() => {
    if (!fontListOpen) return;
    const handler = (e: MouseEvent) => {
      if (fontDropdownRef.current && !fontDropdownRef.current.contains(e.target as Node)) {
        setFontListOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [fontListOpen]);

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

  const applyFont = (font: string) => {
    onConfigChange({ ...config, fontFamily: font });
    setFontListOpen(false);
    setFontSearch("");
  };

  const addCustomIde = () => {
    const name = newIdeName.trim();
    const command = newIdeCommand.trim();
    if (!name || !command) return;
    const exists = (config.customIdes || []).some(
      i => i.name.toLowerCase() === name.toLowerCase() || i.command === command
    );
    if (exists) return;
    onConfigChange({ ...config, customIdes: [...(config.customIdes || []), { name, command }] });
    setNewIdeName("");
    setNewIdeCommand("");
  };

  const removeCustomIde = (idx: number) => {
    const next = [...(config.customIdes || [])];
    next.splice(idx, 1);
    onConfigChange({ ...config, customIdes: next });
  };

  const startEditPreset = (ide: import("../utils/idePresets").IdePreset) => {
    const current = config.ideCommandOverrides?.[ide.id] ?? getIdeCommand(ide);
    setEditingPresetId(ide.id);
    setEditingValue(current);
  };

  const savePresetOverride = (ideId: string) => {
    const trimmed = editingValue.trim();
    const preset = IDE_PRESETS.find(i => i.id === ideId)!;
    const defaultCmd = getIdeCommand(preset);
    const overrides = { ...(config.ideCommandOverrides || {}) };
    if (trimmed && trimmed !== defaultCmd) {
      overrides[ideId] = trimmed;
    } else {
      delete overrides[ideId]; // 恢复默认，移除覆盖
    }
    onConfigChange({ ...config, ideCommandOverrides: overrides });
    setEditingPresetId(null);
  };

  const cancelPresetEdit = () => {
    setEditingPresetId(null);
    setEditingValue("");
  };

  // 获取某个预设的实际命令（考虑覆盖）
  const getEffectiveCommand = (ide: import("../utils/idePresets").IdePreset) =>
    config.ideCommandOverrides?.[ide.id] ?? getIdeCommand(ide);

  const isCustomShell = shellInput !== "" && !PRESET_SHELLS.some(s => s.value === shellInput);

  // 合并内置预设和系统字体，搜索过滤，去重
  const allFonts = Array.from(new Set([...BUILTIN_FONTS, ...systemFonts])).sort(
    (a, b) => a.toLowerCase().localeCompare(b.toLowerCase())
  );
  const filteredFonts = fontSearch.trim()
    ? allFonts.filter(f => f.toLowerCase().includes(fontSearch.trim().toLowerCase()))
    : allFonts;

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

                {/* Font Family */}
                <div className="settings-item settings-item-col">
                  <div className="settings-item-info">
                    <div className="settings-item-name">Font Family</div>
                    <div className="settings-item-desc">
                      Terminal font. System fonts are loaded automatically.
                      Takes effect immediately on existing sessions.
                    </div>
                  </div>

                  {/* 下拉触发器 + 弹出列表 */}
                  <div className="settings-font-dropdown" ref={fontDropdownRef}>
                    {/* 触发器：点击展开/收起 */}
                    <button
                      className={`settings-font-trigger${fontListOpen ? " open" : ""}`}
                      onClick={() => setFontListOpen(v => !v)}
                      style={{ fontFamily: config.fontFamily ? `'${config.fontFamily}', monospace` : "monospace" }}
                    >
                      <span className="settings-font-trigger-text">
                        {config.fontFamily || "Default (JetBrains Mono / Fira Code)"}
                      </span>
                      <span className="settings-font-trigger-actions">
                        {config.fontFamily && (
                          <span
                            className="settings-font-clear"
                            role="button"
                            onClick={e => { e.stopPropagation(); applyFont(""); setFontListOpen(false); }}
                            title="Reset to default"
                          >✕</span>
                        )}
                        <span className="settings-font-arrow">{fontListOpen ? "−" : "+"}</span>
                      </span>
                    </button>

                    {/* 下拉面板 */}
                    {fontListOpen && (
                      <div className="settings-font-panel">
                        <div className="settings-font-search-wrap">
                          <input
                            className="settings-font-search"
                            type="text"
                            placeholder="Search fonts..."
                            value={fontSearch}
                            onChange={e => setFontSearch(e.target.value)}
                            autoFocus
                            spellCheck={false}
                          />
                        </div>
                        <div className="settings-font-list">
                          {fontsLoading ? (
                            <div className="settings-font-loading">Loading system fonts...</div>
                          ) : filteredFonts.length === 0 ? (
                            <div className="settings-font-loading">No fonts found</div>
                          ) : (
                            filteredFonts.map(font => (
                              <button
                                key={font}
                                className={`settings-font-item${config.fontFamily === font ? " active" : ""}${BUILTIN_FONTS.includes(font) ? " builtin" : ""}`}
                                onClick={() => applyFont(font)}
                                title={font}
                              >
                                <span className="settings-font-name">{font}</span>
                                <span className="settings-font-sample" style={{ fontFamily: `'${font}', monospace` }}>
                                  AaBbCc 中文
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Shell */}
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

            {activeNav === "ide" && (
              <>
                <div className="settings-content-title">IDE</div>

                {/* 预设 IDE 列表 */}
                <div className="settings-item settings-item-col">
                  <div className="settings-item-info">
                    <div className="settings-item-name">Preset IDEs</div>
                    <div className="settings-item-desc">
                      Built-in IDE presets. Select one when adding a project, or use Ctrl+O to open.
                    </div>
                  </div>
                  <div className="settings-ide-list">
                    {IDE_PRESETS.map(ide => {
                      const isEditing = editingPresetId === ide.id;
                      const effectiveCmd = getEffectiveCommand(ide);
                      const isOverridden = !!config.ideCommandOverrides?.[ide.id];
                      return (
                        <div key={ide.id} className="settings-ide-item">
                          <span className="settings-ide-icon">{ide.icon}</span>
                          <span className="settings-ide-name">{ide.name}</span>
                          {isEditing ? (
                            <input
                              className="settings-ide-command-input"
                              value={editingValue}
                              autoFocus
                              spellCheck={false}
                              onChange={e => setEditingValue(e.target.value)}
                              onBlur={() => savePresetOverride(ide.id)}
                              onKeyDown={e => {
                                if (e.key === "Enter") savePresetOverride(ide.id);
                                if (e.key === "Escape") cancelPresetEdit();
                              }}
                            />
                          ) : (
                            <span
                              className={`settings-ide-command${isOverridden ? " overridden" : ""}`}
                              title="Double-click to edit"
                              onDoubleClick={() => startEditPreset(ide)}
                            >
                              {effectiveCmd}
                            </span>
                          )}
                          {isOverridden && !isEditing && (
                            <button
                              className="settings-ide-reset"
                              title="Reset to default"
                              onClick={() => {
                                const overrides = { ...(config.ideCommandOverrides || {}) };
                                delete overrides[ide.id];
                                onConfigChange({ ...config, ideCommandOverrides: overrides });
                              }}
                            >↺</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 自定义 IDE */}
                <div className="settings-item settings-item-col" style={{ marginTop: 8 }}>
                  <div className="settings-item-info">
                    <div className="settings-item-name">Custom IDEs</div>
                    <div className="settings-item-desc">
                      Add custom IDEs by specifying a name and executable path or command.
                    </div>
                  </div>

                  {/* 已添加的自定义 IDE */}
                  {(config.customIdes || []).length > 0 && (
                    <div className="settings-ide-list">
                      {(config.customIdes || []).map((ide, idx) => (
                        <div key={idx} className="settings-ide-item">
                          <span className="settings-ide-icon">💻</span>
                          <span className="settings-ide-name">{ide.name}</span>
                          <span className="settings-ide-command">{ide.command}</span>
                          <button
                            className="settings-ide-remove"
                            onClick={() => removeCustomIde(idx)}
                            title="Remove"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 添加新自定义 IDE */}
                  <div className="settings-ide-add">
                    <input
                      className="settings-shell-input"
                      type="text"
                      placeholder="Name, e.g. My Editor"
                      value={newIdeName}
                      onChange={e => setNewIdeName(e.target.value)}
                      spellCheck={false}
                    />
                    <input
                      className="settings-shell-input"
                      type="text"
                      placeholder="Command or path, e.g. D:/zed.exe"
                      value={newIdeCommand}
                      onChange={e => setNewIdeCommand(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addCustomIde(); }}
                      spellCheck={false}
                    />
                    <button
                      className="settings-ide-add-btn"
                      onClick={addCustomIde}
                      disabled={!newIdeName.trim() || !newIdeCommand.trim()}
                    >Add IDE</button>
                  </div>
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

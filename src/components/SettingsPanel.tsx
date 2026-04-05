import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IDE_PRESETS, getIdeCommand, getIdeIconSrc } from "../utils/idePresets";
import { getAgentIconSrc } from "../utils/agents";
import type { AppConfig, DiffMode, AgentConfig } from "../types";
import { EditorIcon, TerminalIcon, CodeIcon, GridIcon, GitLogoIcon, CloseIcon } from "./icons";

// re-export for backward compatibility
export type { AppConfig, DiffMode };

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

type NavCategory = "editor" | "terminal" | "agents" | "ide" | "git";

interface NavItem {
  id: NavCategory;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "editor",
    label: "Editor",
    icon: <EditorIcon size={16} />,
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: <TerminalIcon size={16} />,
  },
  {
    id: "agents",
    label: "Agents",
    icon: <GridIcon size={16} />,
  },
  {
    id: "ide",
    label: "IDE",
    icon: <CodeIcon size={16} />,
  },
  {
    id: "git",
    label: "Git",
    icon: <GitLogoIcon size={16} />,
  },
];

interface SettingsPanelProps {
  config: AppConfig;
  onConfigChange: (next: AppConfig) => void;
  onClose: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = React.memo(({ config, onConfigChange, onClose }) => {
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

  // 自定义 Agent 相关状态
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentCommand, setNewAgentCommand] = useState("");
  const [newAgentArgs, setNewAgentArgs] = useState("");

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

  // 自定义 Agent 管理
  const BUILTIN_AGENTS: AgentConfig[] = [
    { id: "opencode", name: "opencode", command: "opencode", args: [], env: {}, icon: "opencode.png", enabled: true },
    { id: "claude-code", name: "claude-code", command: "claude", args: [], env: {}, icon: "claude-code.png", enabled: true },
    { id: "qwen", name: "qwen", command: "qwen", args: [], env: {}, icon: "qwen.png", enabled: true },
    { id: "gemini", name: "gemini", command: "gemini", args: [], env: {}, icon: "gemini.png", enabled: true },
    { id: "codex", name: "codex", command: "codex", args: [], env: {}, icon: "codex.png", enabled: true },
    { id: "qoder", name: "qoder", command: "qoder", args: [], env: {}, icon: "qoder.svg", enabled: true },
    { id: "codebuddy", name: "codebuddy", command: "codebuddy", args: [], env: {}, icon: "codebuddy.svg", enabled: true },
  ];

  const addCustomAgent = async () => {
    const name = newAgentName.trim();
    const command = newAgentCommand.trim();
    if (!name || !command) return;
    const id = `custom:${name.toLowerCase().replace(/\s+/g, "-")}`;
    const exists = (config.customAgents || []).some(a => a.id === id);
    if (exists) return;
    const args = newAgentArgs.trim() ? newAgentArgs.trim().split(",").map(s => s.trim()).filter(Boolean) : [];
    const newAgent: AgentConfig = { id, name, command, args, env: {}, icon: "cli.svg", enabled: true };
    const nextCustom = [...(config.customAgents || []), newAgent];
    onConfigChange({ ...config, customAgents: nextCustom });
    try {
      await invoke("add_agent", { agent: newAgent });
    } catch (e) {
      console.error("[Settings] Failed to add agent:", e);
    }
    setNewAgentName("");
    setNewAgentCommand("");
    setNewAgentArgs("");
  };

  const removeCustomAgent = async (idx: number) => {
    const agent = (config.customAgents || [])[idx];
    if (!agent) return;
    const nextCustom = [...(config.customAgents || [])];
    nextCustom.splice(idx, 1);
    onConfigChange({ ...config, customAgents: nextCustom });
    try {
      await invoke("remove_agent", { agentId: agent.id });
    } catch (e) {
      console.error("[Settings] Failed to remove agent:", e);
    }
  };

  // 内置 Agent 命令覆盖编辑
  const startEditAgent = (agent: AgentConfig) => {
    const current = config.agentCommandOverrides?.[agent.id] ?? agent.command;
    setEditingPresetId(agent.id);
    setEditingValue(current);
  };

  const saveAgentOverride = (agentId: string) => {
    const trimmed = editingValue.trim();
    const agent = BUILTIN_AGENTS.find(a => a.id === agentId);
    const defaultCmd = agent?.command ?? "";
    const overrides = { ...(config.agentCommandOverrides || {}) };
    if (trimmed && trimmed !== defaultCmd) {
      overrides[agentId] = trimmed;
    } else {
      delete overrides[agentId];
    }
    onConfigChange({ ...config, agentCommandOverrides: overrides });
    setEditingPresetId(null);
  };

  const getEffectiveAgentCommand = (agent: AgentConfig) =>
    config.agentCommandOverrides?.[agent.id] ?? agent.command;

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
  const allFonts = useMemo(
    () => Array.from(new Set([...BUILTIN_FONTS, ...systemFonts])).sort(
      (a, b) => a.toLowerCase().localeCompare(b.toLowerCase())
    ),
    [systemFonts]
  );
  const filteredFonts = useMemo(() => {
    const search = fontSearch.trim().toLowerCase();
    return search ? allFonts.filter(f => f.toLowerCase().includes(search)) : allFonts;
  }, [allFonts, fontSearch]);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-dialog" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="settings-dialog-header">
          <span className="settings-dialog-title">Settings</span>
          <button className="settings-dialog-close" onClick={onClose}>
            <CloseIcon />
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

            {activeNav === "agents" && (
              <>
                <div className="settings-content-title">Agents</div>

                {/* 内置 Agent 列表 */}
                <div className="settings-item settings-item-col">
                  <div className="settings-item-info">
                    <div className="settings-item-name">Built-in Agents</div>
                    <div className="settings-item-desc">
                      Pre-configured AI agent CLIs. Select one when adding a project or from the title bar.
                    </div>
                  </div>
                  <div className="settings-ide-list">
                    {BUILTIN_AGENTS.map(agent => {
                      const iconSrc = getAgentIconSrc(agent.icon);
                      const isEditing = editingPresetId === agent.id;
                      const effectiveCmd = getEffectiveAgentCommand(agent);
                      const isOverridden = !!config.agentCommandOverrides?.[agent.id];
                      return (
                        <div key={agent.id} className="settings-ide-item">
                          {iconSrc ? (
                            <img src={iconSrc} className="agent-icon" alt="" />
                          ) : (
                            <span className="settings-ide-icon">{""}</span>
                          )}
                          <span className="settings-ide-name">{agent.name}</span>
                          {isEditing ? (
                            <input
                              className="settings-ide-command-input"
                              value={editingValue}
                              autoFocus
                              spellCheck={false}
                              onChange={e => setEditingValue(e.target.value)}
                              onBlur={() => saveAgentOverride(agent.id)}
                              onKeyDown={e => {
                                if (e.key === "Enter") saveAgentOverride(agent.id);
                                if (e.key === "Escape") cancelPresetEdit();
                              }}
                            />
                          ) : (
                            <span
                              className={`settings-ide-command${isOverridden ? " overridden" : ""}`}
                              title="Double-click to edit"
                              onDoubleClick={() => startEditAgent(agent)}
                            >
                              {effectiveCmd}
                            </span>
                          )}
                          {isOverridden && !isEditing && (
                            <button
                              className="settings-ide-reset"
                              title="Reset to default"
                              onClick={() => {
                                const overrides = { ...(config.agentCommandOverrides || {}) };
                                delete overrides[agent.id];
                                onConfigChange({ ...config, agentCommandOverrides: overrides });
                              }}
                            >↺</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 自定义 Agent */}
                <div className="settings-item settings-item-col" style={{ marginTop: 8 }}>
                  <div className="settings-item-info">
                    <div className="settings-item-name">Custom Agents</div>
                    <div className="settings-item-desc">
                      Add custom AI agent CLIs by specifying a name, command, and optional arguments.
                    </div>
                  </div>

                  {/* 已添加的自定义 Agent */}
                  {(config.customAgents || []).length > 0 && (
                    <div className="settings-ide-list">
                      {(config.customAgents || []).map((agent, idx) => {
                        const iconSrc = getAgentIconSrc(agent.icon);
                        return (
                          <div key={agent.id} className="settings-ide-item">
                            {iconSrc ? (
                              <img src={iconSrc} className="agent-icon" alt="" />
                            ) : (
                              <span className="settings-ide-icon">{""}</span>
                            )}
                            <span className="settings-ide-name">{agent.name}</span>
                            <span className="settings-ide-command">
                              {agent.command}{agent.args.length > 0 ? " " + agent.args.join(" ") : ""}
                            </span>
                            <button
                              className="settings-ide-remove"
                              onClick={() => removeCustomAgent(idx)}
                              title="Remove"
                            >✕</button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 添加新自定义 Agent */}
                  <div className="settings-ide-add">
                    <input
                      className="settings-shell-input"
                      type="text"
                      placeholder="Name, e.g. My Agent"
                      value={newAgentName}
                      onChange={e => setNewAgentName(e.target.value)}
                      spellCheck={false}
                    />
                    <input
                      className="settings-shell-input"
                      type="text"
                      placeholder="Command, e.g. my-agent"
                      value={newAgentCommand}
                      onChange={e => setNewAgentCommand(e.target.value)}
                      spellCheck={false}
                    />
                    <input
                      className="settings-shell-input"
                      type="text"
                      placeholder="Args (comma separated), e.g. --verbose, --model gpt-4"
                      value={newAgentArgs}
                      onChange={e => setNewAgentArgs(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addCustomAgent(); }}
                      spellCheck={false}
                    />
                    <button
                      className="settings-ide-add-btn"
                      onClick={addCustomAgent}
                      disabled={!newAgentName.trim() || !newAgentCommand.trim()}
                    >Add Agent</button>
                  </div>
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
                      const iconSrc = getIdeIconSrc(ide.icon);
                      return (
                        <div key={ide.id} className="settings-ide-item">
                          <img src={iconSrc} className="settings-ide-icon" alt="" />
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
                          <img src={getIdeIconSrc(null)} className="settings-ide-icon" alt="" />
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
                  <GitLogoIcon size={32} style={{ opacity: 0.3 }} />
                  <span>No Git settings yet</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default SettingsPanel;

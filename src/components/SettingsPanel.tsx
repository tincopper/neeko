import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IDE_PRESETS, getIdeCommand, getIdeIconSrc } from "../utils/idePresets";
import { getAgentIconSrc } from "../utils/agents";
import type { AppConfig, DiffMode, AgentConfig } from "../types";
import { useAppContext } from "../context/app-context";
import { cn } from "../utils/cn";
import { EditorIcon, TerminalIcon, CodeIcon, GridIcon, GitLogoIcon, CloseIcon, AppearanceIcon } from "./icons";
import { Input, Button } from "./ui";

// re-export for backward compatibility
export type { AppConfig, DiffMode };

// Built-in monospace font presets
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

// Platform-specific preset shells
export const PRESET_SHELLS: { label: string; value: string }[] = (
   navigator.platform.toLowerCase().includes("win")
      ? [
         { label: "PowerShell", value: "powershell.exe" },
         { label: "Command Prompt", value: "cmd.exe" },
         { label: "Git Bash", value: "C:\\Program Files\\Git\\bin\\bash.exe" },
         { label: "WSL (bash)", value: "wsl.exe" },
      ]
      : [
         { label: "Default ($SHELL)", value: "" },
         { label: "bash", value: "/bin/bash" },
         { label: "zsh", value: "/bin/zsh" },
         { label: "fish", value: "/usr/bin/fish" },
         { label: "sh", value: "/bin/sh" },
      ]
);

type NavCategory = "editor" | "terminal" | "agents" | "ide" | "git" | "appearance";

interface NavItem {
   id: NavCategory;
   label: string;
   icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
   { id: "appearance", label: "Appearance", icon: <AppearanceIcon size={16} /> },
   { id: "editor", label: "Editor", icon: <EditorIcon size={16} /> },
   { id: "terminal", label: "Terminal", icon: <TerminalIcon size={16} /> },
   { id: "agents", label: "Agents", icon: <GridIcon size={16} /> },
   { id: "ide", label: "IDE", icon: <CodeIcon size={16} /> },
   { id: "git", label: "Git", icon: <GitLogoIcon size={16} /> },
];

interface SettingsPanelProps {
   onConfigChange: (next: AppConfig) => void;
   onClose: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = React.memo(({ onConfigChange, onClose }) => {
   const { config } = useAppContext();
   const [activeNav, setActiveNav] = useState<NavCategory>("editor");
   const [shellInput, setShellInput] = useState(config.shell);

   const [systemFonts, setSystemFonts] = useState<string[]>([]);
   const [fontSearch, setFontSearch] = useState("");
   const [fontsLoading, setFontsLoading] = useState(false);
   const [fontListOpen, setFontListOpen] = useState(false);
   const fontDropdownRef = useRef<HTMLDivElement>(null);

   const [newIdeName, setNewIdeName] = useState("");
   const [newIdeCommand, setNewIdeCommand] = useState("");

   const [newAgentName, setNewAgentName] = useState("");
   const [newAgentCommand, setNewAgentCommand] = useState("");
   const [newAgentArgs, setNewAgentArgs] = useState("");

   const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
   const [editingValue, setEditingValue] = useState("");

   useEffect(() => { setShellInput(config.shell); }, [config.shell]);

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
      try { await invoke("add_agent", { agent: newAgent }); } catch (e) { console.error("[Settings] Failed to add agent:", e); }
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
      try { await invoke("remove_agent", { agentId: agent.id }); } catch (e) { console.error("[Settings] Failed to remove agent:", e); }
   };

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
      if (trimmed && trimmed !== defaultCmd) { overrides[agentId] = trimmed; } else { delete overrides[agentId]; }
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
      if (trimmed && trimmed !== defaultCmd) { overrides[ideId] = trimmed; } else { delete overrides[ideId]; }
      onConfigChange({ ...config, ideCommandOverrides: overrides });
      setEditingPresetId(null);
   };

   const cancelPresetEdit = () => { setEditingPresetId(null); setEditingValue(""); };

   const getEffectiveCommand = (ide: import("../utils/idePresets").IdePreset) =>
      config.ideCommandOverrides?.[ide.id] ?? getIdeCommand(ide);

   const isCustomShell = shellInput !== "" && !PRESET_SHELLS.some(s => s.value === shellInput);

   const allFonts = useMemo(
      () => Array.from(new Set([...BUILTIN_FONTS, ...systemFonts])).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
      [systemFonts]
   );
   const filteredFonts = useMemo(() => {
      const search = fontSearch.trim().toLowerCase();
      return search ? allFonts.filter(f => f.toLowerCase().includes(search)) : allFonts;
   }, [allFonts, fontSearch]);

   return (
      <div className="fixed inset-0 bg-black/55 flex items-center justify-center z-[2000]" onClick={onClose}>
         <div className="w-[720px] h-[480px] bg-bg-secondary border border-border rounded-[10px] shadow-[0_24px_64px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-3.5 px-5 pb-3 border-b border-border shrink-0">
               <span className="text-[0.93em] font-semibold text-text-primary tracking-[0.2px]">Settings</span>
               <button className="bg-none border-none text-text-muted cursor-pointer p-1 rounded flex items-center justify-center transition-[background-color,color] duration-150 hover:bg-bg-hover hover:text-text-primary" onClick={onClose}>
                  <CloseIcon />
               </button>
            </div>

            <div className="flex flex-1 overflow-hidden">
               {/* Left nav */}
               <nav className="w-[168px] shrink-0 bg-bg-primary border-r border-border p-2.5 px-1.5 flex flex-col gap-0.5 overflow-y-auto">
                  {NAV_ITEMS.map(item => (
                     <button
                        key={item.id}
                        className={cn(
                           "flex items-center gap-2.5 py-2 px-3 bg-none border-none rounded-md text-text-secondary text-[0.86em] cursor-pointer text-left transition-[background-color,color] duration-150 w-full hover:bg-bg-hover hover:text-text-primary",
                           activeNav === item.id && "!bg-accent-blue !text-white"
                        )}
                        onClick={() => setActiveNav(item.id)}
                     >
                        <span className={cn("text-text-muted shrink-0 flex items-center", activeNav === item.id && "!text-white")}>{item.icon}</span>
                        <span className="font-medium">{item.label}</span>
                     </button>
                  ))}
               </nav>

               {/* Right content */}
               <div className="flex-1 p-6 px-7 overflow-y-auto">
                  {activeNav === "editor" && (
                     <>
                        <div className="text-[1em] font-semibold text-text-primary mb-5 pb-2.5 border-b border-border">Editor</div>
                        <div className="flex items-center justify-between py-3 border-b border-white/[0.04] gap-6 [&:last-child]:border-b-0">
                           <div className="flex-1 min-w-0">
                              <div className="text-[0.86em] text-text-primary font-medium mb-0.75">Font Size</div>
                              <div className="text-[0.79em] text-text-muted leading-relaxed">Terminal and UI font size in pixels</div>
                           </div>
                           <div className="flex items-center gap-2 shrink-0">
                              <button className="w-7 h-7 bg-bg-tertiary border border-border rounded text-text-primary text-[1.07em] cursor-pointer flex items-center justify-center transition-colors duration-150 hover:bg-bg-hover disabled:opacity-35 disabled:cursor-not-allowed" onClick={() => setFontSize(config.fontSize - 1)} disabled={config.fontSize <= 10}>&minus;</button>
                              <span className="min-w-[44px] text-center text-[0.86em] text-text-primary tabular-nums">{config.fontSize}px</span>
                              <button className="w-7 h-7 bg-bg-tertiary border border-border rounded text-text-primary text-[1.07em] cursor-pointer flex items-center justify-center transition-colors duration-150 hover:bg-bg-hover disabled:opacity-35 disabled:cursor-not-allowed" onClick={() => setFontSize(config.fontSize + 1)} disabled={config.fontSize >= 24}>+</button>
                           </div>
                        </div>
                        <div className="flex items-center justify-between py-3 border-b border-white/[0.04] gap-6 [&:last-child]:border-b-0">
                           <div className="flex-1 min-w-0">
                              <div className="text-[0.86em] text-text-primary font-medium mb-0.75">Diff View Mode</div>
                              <div className="text-[0.79em] text-text-muted leading-relaxed">How file diffs are displayed</div>
                           </div>
                           <div className="flex items-center gap-2 shrink-0">
                              <div className="flex bg-bg-tertiary border border-border rounded-md overflow-hidden">
                                 <button className={cn("py-1 px-3.5 bg-none border-none text-text-secondary text-[0.86em] cursor-pointer transition-[background-color,color] duration-150 hover:bg-bg-hover hover:text-text-primary border-r border-border", config.diffMode === "unified" && "!bg-accent-blue !text-white")} onClick={() => setDiffMode("unified")}>Unified</button>
                                 <button className={cn("py-1 px-3.5 bg-none border-none text-text-secondary text-[0.86em] cursor-pointer transition-[background-color,color] duration-150 hover:bg-bg-hover hover:text-text-primary", config.diffMode === "split" && "!bg-accent-blue !text-white")} onClick={() => setDiffMode("split")}>Split</button>
                              </div>
                           </div>
                        </div>
                     </>
                  )}

                  {activeNav === "terminal" && (
                     <>
                        <div className="text-[1em] font-semibold text-text-primary mb-5 pb-2.5 border-b border-border">Terminal</div>
                        {/* Font Family */}
                        <div className="flex flex-col items-start gap-3 py-3 border-b border-white/[0.04] [&:last-child]:border-b-0">
                           <div className="flex-1 min-w-0">
                              <div className="text-[0.86em] text-text-primary font-medium mb-0.75">Font Family</div>
                              <div className="text-[0.79em] text-text-muted leading-relaxed">Terminal font. System fonts are loaded automatically. Takes effect immediately on existing sessions.</div>
                           </div>
                           <div className="relative w-full" ref={fontDropdownRef}>
                              <button
                                 className={cn(
                                    "flex items-center justify-between w-full py-[7px] px-2.5 bg-bg-tertiary border border-border rounded text-[0.86em] text-text-primary cursor-pointer text-left box-border transition-[border-color] duration-150 gap-2 hover:border-accent-blue",
                                    fontListOpen && "!border-accent-blue"
                                 )}
                                 onClick={() => setFontListOpen(v => !v)}
                                 style={{ fontFamily: config.fontFamily ? `'${config.fontFamily}', monospace` : "monospace" }}
                              >
                                 <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap min-w-0">{config.fontFamily || "Default (JetBrains Mono / Fira Code)"}</span>
                                 <span className="flex items-center gap-1.5 shrink-0">
                                    {config.fontFamily && (
                                       <span className="text-text-muted cursor-pointer text-[0.79em] leading-none py-px px-[3px] rounded-[3px] hover:text-text-primary hover:bg-bg-hover" role="button"
                                          onClick={e => { e.stopPropagation(); applyFont(""); setFontListOpen(false); }} title="Reset to default">&times;</span>
                                    )}
                                    <span className="text-[0.72em] text-text-muted">{fontListOpen ? "\u2212" : "+"}</span>
                                 </span>
                              </button>
                              {fontListOpen && (
                                 <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-bg-secondary border border-accent-blue rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.5)] z-[100] overflow-hidden">
                                    <div className="py-2 px-2 pb-1.5 border-b border-border">
                                       <Input className="w-full box-border py-1 px-2 text-[0.86em]" type="text" placeholder="Search fonts..." value={fontSearch} onChange={e => setFontSearch(e.target.value)} autoFocus spellCheck={false} />
                                    </div>
                                    <div className="w-full max-h-[200px] overflow-y-auto">
                                       {fontsLoading ? (
                                          <div className="p-4 text-center text-[0.82em] text-text-muted">Loading system fonts...</div>
                                       ) : filteredFonts.length === 0 ? (
                                          <div className="p-4 text-center text-[0.82em] text-text-muted">No fonts found</div>
                                       ) : filteredFonts.map(font => (
                                          <button key={font}
                                             className={cn(
                                                "flex items-center justify-between w-full py-[7px] px-3 bg-none border-none border-b border-white/[0.03] text-text-secondary text-[0.86em] cursor-pointer text-left box-border transition-[background-color] duration-100 gap-3 hover:bg-bg-hover hover:text-text-primary [&:last-child]:border-b-0",
                                                config.fontFamily === font && "!bg-accent-blue/15 !text-accent-blue"
                                             )}
                                             onClick={() => applyFont(font)} title={font}>
                                             <span className="shrink-0 font-medium min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{font}</span>
                                             <span className="text-[0.86em] text-text-muted whitespace-nowrap shrink-0" style={{ fontFamily: `'${font}', monospace` }}>AaBbCc</span>
                                          </button>
                                       ))}
                                    </div>
                                 </div>
                              )}
                           </div>
                        </div>
                        {/* Shell */}
                        <div className="flex flex-col items-start gap-3 py-3 border-b border-white/[0.04] [&:last-child]:border-b-0">
                           <div className="flex-1 min-w-0">
                              <div className="text-[0.86em] text-text-primary font-medium mb-0.75">Shell</div>
                              <div className="text-[0.79em] text-text-muted leading-relaxed">Select a preset or enter a custom shell path. Takes effect on the next terminal session.</div>
                           </div>
                           <div className="flex flex-wrap gap-1.5 w-full">
                              {PRESET_SHELLS.map(({ label, value }) => (
                                 <button key={value}
                                    className={cn(
                                       "py-1 px-3 bg-bg-tertiary border border-border rounded text-text-secondary text-[0.82em] cursor-pointer transition-all duration-150 whitespace-nowrap hover:bg-bg-hover hover:text-text-primary hover:border-text-muted",
                                       shellInput === value && "!bg-accent-blue !border-accent-blue !text-white"
                                    )}
                                    onClick={() => applyShell(value)} title={value || "Use $SHELL environment variable"}>
                                    {label}
                                 </button>
                              ))}
                           </div>
                           <Input
                              className={cn(
                                 "py-[7px] px-2.5 text-[0.86em]",
                                 isCustomShell && "!border-accent-blue"
                              )}
                              type="text" placeholder="Custom path, e.g. /usr/bin/zsh" value={shellInput}
                              onChange={e => setShellInput(e.target.value)}
                              onBlur={e => applyShell(e.target.value.trim())}
                              onKeyDown={e => { if (e.key === "Enter") applyShell(shellInput.trim()); }}
                              spellCheck={false} />
                        </div>
                     </>
                  )}

                  {activeNav === "agents" && (
                     <>
                        <div className="text-[1em] font-semibold text-text-primary mb-5 pb-2.5 border-b border-border">Agents</div>

                        <div className="flex flex-col items-start gap-3 py-3 border-b border-white/[0.04]">
                           <div className="flex-1 min-w-0">
                              <div className="text-[0.86em] text-text-primary font-medium mb-0.75">Show Agent Bar</div>
                              <div className="text-[0.79em] text-text-muted leading-relaxed">Display agent buttons in the title bar for quick selection.</div>
                           </div>
                           <Button
                              variant={config.agentSelectorShowPresetBar !== false ? "primary" : "ghost"}
                              size="sm"
                              onClick={() => onConfigChange({ ...config, agentSelectorShowPresetBar: config.agentSelectorShowPresetBar === false })}
                           >
                              {config.agentSelectorShowPresetBar !== false ? "On" : "Off"}
                           </Button>
                        </div>

                        <div className="flex flex-col items-start gap-3 py-3 border-b border-white/[0.04]">
                           <div className="flex-1 min-w-0">
                              <div className="text-[0.86em] text-text-primary font-medium mb-0.75">Compact Mode</div>
                              <div className="text-[0.79em] text-text-muted leading-relaxed">Show only icons in the agent bar.</div>
                           </div>
                           <Button
                              variant={config.agentSelectorCompactMode ? "primary" : "ghost"}
                              size="sm"
                              onClick={() => onConfigChange({ ...config, agentSelectorCompactMode: !config.agentSelectorCompactMode })}
                           >
                              {config.agentSelectorCompactMode ? "On" : "Off"}
                           </Button>
                        </div>

                        <div className="flex flex-col items-start gap-3 py-3 border-b border-white/[0.04] [&:last-child]:border-b-0">
                           <div className="flex-1 min-w-0">
                              <div className="text-[0.86em] text-text-primary font-medium mb-0.75">Built-in Agents</div>
                              <div className="text-[0.79em] text-text-muted leading-relaxed">Pre-configured AI agent CLIs. Select one when adding a project or from the title bar.</div>
                           </div>
                           <div className="w-full border border-border rounded overflow-hidden bg-bg-primary">
                              {BUILTIN_AGENTS.map(agent => {
                                 const iconSrc = getAgentIconSrc(agent.icon);
                                 const isEditing = editingPresetId === agent.id;
                                 const effectiveCmd = getEffectiveAgentCommand(agent);
                                 const isOverridden = !!config.agentCommandOverrides?.[agent.id];
                                 return (
                                    <div key={agent.id} className="flex items-center gap-2.5 py-[7px] px-3 border-b border-white/[0.03] text-[0.86em] [&:last-child]:border-b-0">
                                       {iconSrc ? (
                                          <img src={iconSrc} className="text-[var(--font-size)] w-[18px] h-[18px] object-contain" alt="" />
                                       ) : (
                                          <span className="text-[0.93em] w-[18px] h-[18px] text-center shrink-0 object-contain">{""}</span>
                                       )}
                                       <span className="text-text-primary font-medium min-w-[100px] shrink-0">{agent.name}</span>
                                       {isEditing ? (
                                          <Input className="flex-1 min-w-0 py-0.5 px-1.5 text-[0.82em]" value={editingValue} autoFocus spellCheck={false}
                                             onChange={e => setEditingValue(e.target.value)}
                                             onBlur={() => saveAgentOverride(agent.id)}
                                             onKeyDown={e => { if (e.key === "Enter") saveAgentOverride(agent.id); if (e.key === "Escape") cancelPresetEdit(); }} />
                                       ) : (
                                          <span className={cn("text-text-muted font-mono text-[0.82em] flex-1 overflow-hidden text-ellipsis whitespace-nowrap cursor-text rounded py-px px-1 transition-colors duration-150 hover:bg-bg-hover hover:text-text-secondary", isOverridden && "!text-accent-blue")}
                                             title="Double-click to edit" onDoubleClick={() => startEditAgent(agent)}>
                                             {effectiveCmd}
                                          </span>
                                       )}
                                       {isOverridden && !isEditing && (
                                          <button className="bg-none border-none text-text-muted cursor-pointer text-[0.93em] py-0.5 px-1 rounded shrink-0 transition-colors duration-150 leading-none hover:text-accent-blue" title="Reset to default"
                                             onClick={() => { const overrides = { ...(config.agentCommandOverrides || {}) }; delete overrides[agent.id]; onConfigChange({ ...config, agentCommandOverrides: overrides }); }}>&#x21BA;</button>
                                       )}
                                    </div>
                                 );
                              })}
                           </div>
                        </div>
                        <div className="flex flex-col items-start gap-3 py-3 border-b border-white/[0.04] [&:last-child]:border-b-0 mt-2">
                           <div className="flex-1 min-w-0">
                              <div className="text-[0.86em] text-text-primary font-medium mb-0.75">Custom Agents</div>
                              <div className="text-[0.79em] text-text-muted leading-relaxed">Add custom AI agent CLIs by specifying a name, command, and optional arguments.</div>
                           </div>
                           {(config.customAgents || []).length > 0 && (
                              <div className="w-full border border-border rounded overflow-hidden bg-bg-primary">
                                 {(config.customAgents || []).map((agent, idx) => {
                                    const iconSrc = getAgentIconSrc(agent.icon);
                                    return (
                                       <div key={agent.id} className="flex items-center gap-2.5 py-[7px] px-3 border-b border-white/[0.03] text-[0.86em] [&:last-child]:border-b-0">
                                          {iconSrc ? <img src={iconSrc} className="text-[var(--font-size)] w-[18px] h-[18px] object-contain" alt="" /> : <span className="text-[0.93em] w-[18px] h-[18px] text-center shrink-0">{""}</span>}
                                          <span className="text-text-primary font-medium min-w-[100px] shrink-0">{agent.name}</span>
                                          <span className="text-text-muted font-mono text-[0.82em] flex-1">{agent.command}{agent.args.length > 0 ? " " + agent.args.join(" ") : ""}</span>
                                          <button className="bg-none border-none text-text-muted cursor-pointer text-[0.79em] py-0.5 px-1 rounded ml-auto shrink-0 hover:text-text-primary hover:bg-bg-hover" onClick={() => removeCustomAgent(idx)} title="Remove">&times;</button>
                                       </div>
                                    );
                                 })}
                              </div>
                           )}
                           <div className="flex flex-col gap-1.5 w-full">
                              <Input className="py-[7px] px-2.5 text-[0.86em]" type="text" placeholder="Name, e.g. My Agent" value={newAgentName} onChange={e => setNewAgentName(e.target.value)} spellCheck={false} />
                              <Input className="py-[7px] px-2.5 text-[0.86em]" type="text" placeholder="Command, e.g. my-agent" value={newAgentCommand} onChange={e => setNewAgentCommand(e.target.value)} spellCheck={false} />
                              <Input className="py-[7px] px-2.5 text-[0.86em]" type="text" placeholder="Args (comma separated), e.g. --verbose, --model gpt-4" value={newAgentArgs} onChange={e => setNewAgentArgs(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addCustomAgent(); }} spellCheck={false} />
                              <Button variant="primary" size="sm" className="self-end" onClick={addCustomAgent} disabled={!newAgentName.trim() || !newAgentCommand.trim()}>Add Agent</Button>
                           </div>
                        </div>
                     </>
                  )}

                  {activeNav === "ide" && (
                     <>
                        <div className="text-[1em] font-semibold text-text-primary mb-5 pb-2.5 border-b border-border">IDE</div>
                        <div className="flex flex-col items-start gap-3 py-3 border-b border-white/[0.04] [&:last-child]:border-b-0">
                           <div className="flex-1 min-w-0">
                              <div className="text-[0.86em] text-text-primary font-medium mb-0.75">Preset IDEs</div>
                              <div className="text-[0.79em] text-text-muted leading-relaxed">Built-in IDE presets. Select one when adding a project, or use Ctrl+O to open.</div>
                           </div>
                           <div className="w-full border border-border rounded overflow-hidden bg-bg-primary">
                              {IDE_PRESETS.map(ide => {
                                 const isEditing = editingPresetId === ide.id;
                                 const effectiveCmd = getEffectiveCommand(ide);
                                 const isOverridden = !!config.ideCommandOverrides?.[ide.id];
                                 const iconSrc = getIdeIconSrc(ide.icon);
                                 return (
                                    <div key={ide.id} className="flex items-center gap-2.5 py-[7px] px-3 border-b border-white/[0.03] text-[0.86em] [&:last-child]:border-b-0">
                                       <img src={iconSrc} className="text-[0.93em] w-[18px] h-[18px] text-center shrink-0 object-contain" alt="" />
                                       <span className="text-text-primary font-medium min-w-[100px] shrink-0">{ide.name}</span>
                                       {isEditing ? (
                                          <Input className="flex-1 min-w-0 py-0.5 px-1.5 text-[0.82em]" value={editingValue} autoFocus spellCheck={false}
                                             onChange={e => setEditingValue(e.target.value)}
                                             onBlur={() => savePresetOverride(ide.id)}
                                             onKeyDown={e => { if (e.key === "Enter") savePresetOverride(ide.id); if (e.key === "Escape") cancelPresetEdit(); }} />
                                       ) : (
                                          <span className={cn("text-text-muted font-mono text-[0.82em] flex-1 overflow-hidden text-ellipsis whitespace-nowrap cursor-text rounded py-px px-1 transition-colors duration-150 hover:bg-bg-hover hover:text-text-secondary", isOverridden && "!text-accent-blue")}
                                             title="Double-click to edit" onDoubleClick={() => startEditPreset(ide)}>
                                             {effectiveCmd}
                                          </span>
                                       )}
                                       {isOverridden && !isEditing && (
                                          <button className="bg-none border-none text-text-muted cursor-pointer text-[0.93em] py-0.5 px-1 rounded shrink-0 transition-colors duration-150 leading-none hover:text-accent-blue" title="Reset to default"
                                             onClick={() => { const overrides = { ...(config.ideCommandOverrides || {}) }; delete overrides[ide.id]; onConfigChange({ ...config, ideCommandOverrides: overrides }); }}>&#x21BA;</button>
                                       )}
                                    </div>
                                 );
                              })}
                           </div>
                        </div>
                        <div className="flex flex-col items-start gap-3 py-3 border-b border-white/[0.04] [&:last-child]:border-b-0 mt-2">
                           <div className="flex-1 min-w-0">
                              <div className="text-[0.86em] text-text-primary font-medium mb-0.75">Custom IDEs</div>
                              <div className="text-[0.79em] text-text-muted leading-relaxed">Add custom IDEs by specifying a name and executable path or command.</div>
                           </div>
                           {(config.customIdes || []).length > 0 && (
                              <div className="w-full border border-border rounded overflow-hidden bg-bg-primary">
                                 {(config.customIdes || []).map((ide, idx) => (
                                    <div key={idx} className="flex items-center gap-2.5 py-[7px] px-3 border-b border-white/[0.03] text-[0.86em] [&:last-child]:border-b-0">
                                       <img src={getIdeIconSrc(null)} className="text-[0.93em] w-[18px] h-[18px] text-center shrink-0 object-contain" alt="" />
                                       <span className="text-text-primary font-medium min-w-[100px] shrink-0">{ide.name}</span>
                                       <span className="text-text-muted font-mono text-[0.82em] flex-1">{ide.command}</span>
                                       <button className="bg-none border-none text-text-muted cursor-pointer text-[0.79em] py-0.5 px-1 rounded ml-auto shrink-0 hover:text-text-primary hover:bg-bg-hover" onClick={() => removeCustomIde(idx)} title="Remove">&times;</button>
                                    </div>
                                 ))}
                              </div>
                           )}
                           <div className="flex flex-col gap-1.5 w-full">
                              <Input className="py-[7px] px-2.5 text-[0.86em]" type="text" placeholder="Name, e.g. My Editor" value={newIdeName} onChange={e => setNewIdeName(e.target.value)} spellCheck={false} />
                              <Input className="py-[7px] px-2.5 text-[0.86em]" type="text" placeholder="Command or path, e.g. D:/zed.exe" value={newIdeCommand} onChange={e => setNewIdeCommand(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addCustomIde(); }} spellCheck={false} />
                              <Button variant="primary" size="sm" className="self-end" onClick={addCustomIde} disabled={!newIdeName.trim() || !newIdeCommand.trim()}>Add IDE</Button>
                           </div>
                        </div>
                     </>
                  )}

                  {activeNav === "git" && (
                     <>
                        <div className="text-[1em] font-semibold text-text-primary mb-5 pb-2.5 border-b border-border">Git</div>
                        <div className="flex flex-col items-center justify-center gap-3 p-12 text-text-muted text-[0.86em]">
                           <GitLogoIcon size={32} className="opacity-30" />
                           <span>No Git settings yet</span>
                        </div>
                     </>
                  )}

                   {activeNav === "appearance" && (
                      <div className="flex flex-col">
                         <h3 className="text-base font-semibold text-text-primary mb-4">Appearance</h3>
                         <label className="text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">Theme</label>
                         <div className="flex gap-3 flex-wrap">
                            {/* Dark card */}
                            <button
                               className={cn(
                                  "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all duration-150 cursor-pointer bg-bg-tertiary hover:bg-bg-hover",
                                  config.theme === "dark" ? "border-accent-blue" : "border-transparent"
                               )}
                               onClick={() => onConfigChange({ ...config, theme: "dark" })}
                            >
                               <div className="w-16 h-10 rounded border border-white/10 bg-[#000000] flex items-center justify-center">
                                  <span className="text-[#61afef] text-xs font-semibold">Aa</span>
                               </div>
                               <span className="text-sm text-text-primary">Dark</span>
                            </button>
                            {/* One Dark Pro card */}
                            <button
                               className={cn(
                                  "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all duration-150 cursor-pointer bg-bg-tertiary hover:bg-bg-hover",
                                  config.theme === "one-dark-pro" ? "border-accent-blue" : "border-transparent"
                               )}
                               onClick={() => onConfigChange({ ...config, theme: "one-dark-pro" })}
                            >
                               <div className="w-16 h-10 rounded border border-white/10 bg-[#282c34] flex items-center justify-center">
                                  <span className="text-[#61afef] text-xs font-semibold">Aa</span>
                               </div>
                               <span className="text-sm text-text-primary">One Dark Pro</span>
                            </button>
                             {/* Claude card */}
                             <button
                                className={cn(
                                   "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all duration-150 cursor-pointer bg-bg-tertiary hover:bg-bg-hover",
                                   config.theme === "claude" ? "border-accent-blue" : "border-transparent"
                                )}
                                onClick={() => onConfigChange({ ...config, theme: "claude" })}
                             >
                                <div className="w-16 h-10 rounded border border-black/10 bg-[#f5f0e8] flex items-center justify-center">
                                   <span className="text-[#c96442] text-xs font-semibold">Aa</span>
                                </div>
                                <span className="text-sm text-text-primary">Claude</span>
                             </button>
                             {/* Light card */}
                             <button
                                className={cn(
                                   "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all duration-150 cursor-pointer bg-bg-tertiary hover:bg-bg-hover",
                                   config.theme === "light" ? "border-accent-blue" : "border-transparent"
                                )}
                                onClick={() => onConfigChange({ ...config, theme: "light" })}
                             >
                                <div className="w-16 h-10 rounded border border-black/10 bg-[#ffffff] flex items-center justify-center">
                                   <span className="text-[#2f7cd3] text-xs font-semibold">Aa</span>
                                </div>
                                <span className="text-sm text-text-primary">Light</span>
                             </button>
                         </div>
                      </div>
                   )}
               </div>
            </div>
         </div>
      </div>
   );
});

export default SettingsPanel;

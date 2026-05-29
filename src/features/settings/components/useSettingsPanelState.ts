import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AgentConfig, AppConfig, DiffMode } from "../../../types";
import { IDE_PRESETS, getIdeCommand } from "../../../utils/idePresets";
import type { IdePreset } from "../../../utils/idePresets";
import {
  BUILTIN_FONTS,
  PRESET_SHELLS,
  type SettingsNavId,
} from "./constants";

interface UseSettingsPanelStateParams {
  config: AppConfig;
  activeNav: SettingsNavId;
  builtinAgents: AgentConfig[];
  onConfigChange: (next: AppConfig) => void;
  onClose: () => void;
}

export function useSettingsPanelState({
  config,
  activeNav,
  builtinAgents,
  onConfigChange,
  onClose,
}: UseSettingsPanelStateParams) {
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
  const [newAgentSkillPath, setNewAgentSkillPath] = useState("");

  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [skillPathEditingAgentId, setSkillPathEditingAgentId] = useState<
    string | null
  >(null);
  const [skillPathInputValue, setSkillPathInputValue] = useState("");

  useEffect(() => {
    setShellInput(config.shell);
  }, [config.shell]);

  const loadFonts = useCallback(async () => {
    if (systemFonts.length > 0) {
      return;
    }
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
    if (activeNav === "terminal") {
      void loadFonts();
    }
  }, [activeNav, loadFonts]);

  useEffect(() => {
    if (!fontListOpen) {
      return;
    }
    const handler = (e: MouseEvent) => {
      if (
        fontDropdownRef.current &&
        !fontDropdownRef.current.contains(e.target as Node)
      ) {
        setFontListOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [fontListOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const setAppearanceFontSize = (size: number) =>
    onConfigChange({
      ...config,
      appearanceFontSize: Math.min(24, Math.max(10, size)),
    });

  const setEditorFontSize = (size: number) =>
    onConfigChange({
      ...config,
      editorFontSize: Math.min(24, Math.max(10, size)),
    });

  const setTerminalFontSize = (size: number) =>
    onConfigChange({
      ...config,
      terminalFontSize: Math.min(24, Math.max(10, size)),
    });

  const setGpuAcceleration = (enabled: boolean) =>
    onConfigChange({ ...config, terminalGpuAcceleration: enabled });

  const setDiffMode = (diffMode: DiffMode) =>
    onConfigChange({
      ...config,
      diffMode,
    });

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
    if (!name || !command) {
      return;
    }
    const exists = (config.customIdes || []).some(
      (ide) =>
        ide.name.toLowerCase() === name.toLowerCase() || ide.command === command,
    );
    if (exists) {
      return;
    }
    onConfigChange({
      ...config,
      customIdes: [...(config.customIdes || []), { name, command }],
    });
    setNewIdeName("");
    setNewIdeCommand("");
  };

  const removeCustomIde = (idx: number) => {
    const next = [...(config.customIdes || [])];
    next.splice(idx, 1);
    onConfigChange({ ...config, customIdes: next });
  };

  const addCustomAgent = async () => {
    const name = newAgentName.trim();
    const command = newAgentCommand.trim();
    if (!name || !command) {
      return;
    }
    const id = `custom:${name.toLowerCase().replace(/\s+/g, "-")}`;
    const exists = (config.customAgents || []).some((agent) => agent.id === id);
    if (exists) {
      return;
    }

    const args = newAgentArgs.trim()
      ? newAgentArgs
          .trim()
          .split(",")
          .map((arg) => arg.trim())
          .filter(Boolean)
      : [];

    const newAgent: AgentConfig = {
      id,
      name,
      command,
      args,
      env: {},
      icon: "cli.svg",
      enabled: true,
    };

    const nextCustom = [...(config.customAgents || []), newAgent];
    const nextOverrides = { ...(config.agentSkillPathOverrides || {}) };
    if (newAgentSkillPath.trim()) {
      nextOverrides[id] = newAgentSkillPath.trim();
    }

    onConfigChange({
      ...config,
      customAgents: nextCustom,
      agentSkillPathOverrides: nextOverrides,
    });

    try {
      await invoke("add_agent", { agent: newAgent });
    } catch (e) {
      console.error("[Settings] Failed to add agent:", e);
    }

    setNewAgentName("");
    setNewAgentCommand("");
    setNewAgentArgs("");
    setNewAgentSkillPath("");
  };

  const removeCustomAgent = async (idx: number) => {
    const agent = (config.customAgents || [])[idx];
    if (!agent) {
      return;
    }
    const nextCustom = [...(config.customAgents || [])];
    nextCustom.splice(idx, 1);
    onConfigChange({ ...config, customAgents: nextCustom });
    try {
      await invoke("remove_agent", { agentId: agent.id });
    } catch (e) {
      console.error("[Settings] Failed to remove agent:", e);
    }
  };

  const startEditAgent = (agent: AgentConfig) => {
    const current = config.agentCommandOverrides?.[agent.id] ?? agent.command;
    setEditingPresetId(agent.id);
    setEditingValue(current);
  };

  const saveAgentOverride = (agentId: string) => {
    const trimmed = editingValue.trim();
    const agent = builtinAgents.find((item) => item.id === agentId);
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

  const getEffectiveSkillPath = (
    agentId: string,
    fallback: string | null | undefined,
  ) => config.agentSkillPathOverrides?.[agentId] ?? fallback ?? "";

  const selectSkillPath = async (
    agentId: string,
    fallback: string | null | undefined,
  ) => {
    try {
      const selected = await open({ multiple: false, directory: true });
      if (selected && typeof selected === "string") {
        const overrides = { ...(config.agentSkillPathOverrides || {}) };
        if (selected !== fallback) {
          overrides[agentId] = selected;
        } else {
          delete overrides[agentId];
        }
        onConfigChange({ ...config, agentSkillPathOverrides: overrides });
      }
    } catch (e) {
      console.error("[Settings] Failed to select skill path:", e);
    }
  };

  const startEditSkillPath = (agentId: string, currentPath: string) => {
    setSkillPathEditingAgentId(agentId);
    setSkillPathInputValue(currentPath);
  };

  const saveSkillPath = (agentId: string, fallback: string | null | undefined) => {
    const trimmed = skillPathInputValue.trim();
    const overrides = { ...(config.agentSkillPathOverrides || {}) };
    if (trimmed && trimmed !== fallback) {
      overrides[agentId] = trimmed;
    } else {
      delete overrides[agentId];
    }
    onConfigChange({ ...config, agentSkillPathOverrides: overrides });
    setSkillPathEditingAgentId(null);
  };

  const cancelSkillPathEdit = () => {
    setSkillPathEditingAgentId(null);
  };

  const startEditPreset = (ide: IdePreset) => {
    const current = config.ideCommandOverrides?.[ide.id] ?? getIdeCommand(ide);
    setEditingPresetId(ide.id);
    setEditingValue(current);
  };

  const savePresetOverride = (ideId: string) => {
    const trimmed = editingValue.trim();
    const preset = IDE_PRESETS.find((item) => item.id === ideId);
    if (!preset) {
      setEditingPresetId(null);
      return;
    }
    const defaultCmd = getIdeCommand(preset);
    const overrides = { ...(config.ideCommandOverrides || {}) };
    if (trimmed && trimmed !== defaultCmd) {
      overrides[ideId] = trimmed;
    } else {
      delete overrides[ideId];
    }
    onConfigChange({ ...config, ideCommandOverrides: overrides });
    setEditingPresetId(null);
  };

  const cancelPresetEdit = () => {
    setEditingPresetId(null);
    setEditingValue("");
  };

  const getEffectiveCommand = (ide: IdePreset) =>
    config.ideCommandOverrides?.[ide.id] ?? getIdeCommand(ide);

  const isCustomShell =
    shellInput !== "" && !PRESET_SHELLS.some((item) => item.value === shellInput);

  const allFonts = useMemo(
    () =>
      Array.from(new Set([...BUILTIN_FONTS, ...systemFonts])).sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase()),
      ),
    [systemFonts],
  );

  const filteredFonts = useMemo(() => {
    const search = fontSearch.trim().toLowerCase();
    return search
      ? allFonts.filter((font) => font.toLowerCase().includes(search))
      : allFonts;
  }, [allFonts, fontSearch]);

  return {
    shellInput,
    setShellInput,
    fontSearch,
    setFontSearch,
    fontsLoading,
    fontListOpen,
    setFontListOpen,
    fontDropdownRef,
    editingPresetId,
    editingValue,
    setEditingValue,
    skillPathEditingAgentId,
    skillPathInputValue,
    setSkillPathInputValue,
    newIdeName,
    setNewIdeName,
    newIdeCommand,
    setNewIdeCommand,
    newAgentName,
    setNewAgentName,
    newAgentCommand,
    setNewAgentCommand,
    newAgentArgs,
    setNewAgentArgs,
    newAgentSkillPath,
    setNewAgentSkillPath,
    isCustomShell,
    filteredFonts,

    setAppearanceFontSize,
    setEditorFontSize,
    setTerminalFontSize,
    setDiffMode,
    applyShell,
    applyFont,
    setGpuAcceleration,

    addCustomIde,
    removeCustomIde,
    addCustomAgent,
    removeCustomAgent,

    startEditAgent,
    saveAgentOverride,
    getEffectiveAgentCommand,

    getEffectiveSkillPath,
    selectSkillPath,
    startEditSkillPath,
    saveSkillPath,
    cancelSkillPathEdit,

    startEditPreset,
    savePresetOverride,
    cancelPresetEdit,
    getEffectiveCommand,
  };
}

import { open } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AgentConfig, AppConfig, DiffMode } from '@/shared/types';
import { IDE_PRESETS, getIdeCommand } from '@/shared/utils/idePresets';
import type { IdePreset } from '@/shared/utils/idePresets';

// eslint-disable-next-line import/no-restricted-paths -- settings panel state management needs agent API
import { addAgent, removeAgent } from '../../agent/api/agentApi';
import { getSystemFonts, resetSystemFonts } from '../api/settingsApi';

import { BUILTIN_FONTS, PRESET_SHELLS, type SettingsNavId } from './constants';

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

  // Sync shell input when config changes
  useEffect(() => {
    // Defer to avoid sync setState in effect
    Promise.resolve().then(() => setShellInput(config.shell));
  }, [config.shell]);

  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [fontSearch, setFontSearch] = useState('');
  const [fontsLoading, setFontsLoading] = useState(false);
  const [fontListOpen, setFontListOpen] = useState(false);
  const fontDropdownRef = useRef<HTMLDivElement>(null);

  const [newIdeName, setNewIdeName] = useState('');
  const [newIdeCommand, setNewIdeCommand] = useState('');

  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [skillPathEditingAgentId, setSkillPathEditingAgentId] = useState<string | null>(null);
  const [skillPathInputValue, setSkillPathInputValue] = useState('');

  const loadFonts = useCallback(async () => {
    if (systemFonts.length > 0) {
      return;
    }
    setFontsLoading(true);
    try {
      const fonts = await getSystemFonts();
      setSystemFonts(fonts);
    } catch (e) {
      console.error('Failed to load system fonts:', e);
    } finally {
      setFontsLoading(false);
    }
  }, [systemFonts.length]);

  /** 安装新字体后强制刷新：先失效后端进程缓存，再绕过本地短路重新拉取。 */
  const refreshFonts = useCallback(async () => {
    setFontsLoading(true);
    try {
      await resetSystemFonts();
      const fonts = await getSystemFonts();
      setSystemFonts(fonts);
    } catch (e) {
      console.error('Failed to refresh system fonts:', e);
    } finally {
      setFontsLoading(false);
    }
  }, []);

  // Load fonts — use Promise.resolve().then to avoid sync setState in effect
  useEffect(() => {
    if (activeNav === 'terminal' && systemFonts.length === 0) {
      Promise.resolve().then(() => loadFonts());
    }
  }, [activeNav, loadFonts, systemFonts.length]);

  useEffect(() => {
    if (!fontListOpen) {
      return;
    }
    const handler = (e: MouseEvent) => {
      if (fontDropdownRef.current && !fontDropdownRef.current.contains(e.target as Node)) {
        setFontListOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [fontListOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
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
    onConfigChange({ ...config, fontFamily: font, monoFontFamily: font });
    setFontListOpen(false);
    setFontSearch('');
  };

  const addCustomIde = () => {
    const name = newIdeName.trim();
    const command = newIdeCommand.trim();
    if (!name || !command) {
      return;
    }
    const exists = (config.customIdes || []).some(
      (ide) => ide.name.toLowerCase() === name.toLowerCase() || ide.command === command,
    );
    if (exists) {
      return;
    }
    onConfigChange({
      ...config,
      customIdes: [...(config.customIdes || []), { name, command }],
    });
    setNewIdeName('');
    setNewIdeCommand('');
  };

  const removeCustomIde = (idx: number) => {
    const next = [...(config.customIdes || [])];
    next.splice(idx, 1);
    onConfigChange({ ...config, customIdes: next });
  };

  /** Upsert an agent into the customAgents array by matching ID. */
  function upsertCustomAgent(agents: AgentConfig[], updated: AgentConfig): AgentConfig[] {
    const idx = agents.findIndex((a) => a.id === updated.id);
    if (idx >= 0) {
      const next = [...agents];
      next[idx] = updated;
      return next;
    }
    return [...agents, updated];
  }

  /** 新建/编辑自定义 Agent（AgentForm 提交）：更新 customAgents + 持久化 add_agent。 */
  const saveCustomAgent = useCallback(
    async (agent: AgentConfig) => {
      const nextCustom = upsertCustomAgent(config.customAgents ?? [], agent);
      onConfigChange({ ...config, customAgents: nextCustom });
      try {
        await addAgent(agent);
      } catch (e) {
        console.error('[Settings] Failed to save agent:', e);
      }
    },
    [config, onConfigChange],
  );

  /** 删除自定义 Agent（按 id）：更新 customAgents + 持久化 remove_agent。 */
  const removeCustomAgentById = useCallback(
    async (agentId: string) => {
      const nextCustom = (config.customAgents ?? []).filter((a) => a.id !== agentId);
      onConfigChange({ ...config, customAgents: nextCustom });
      try {
        await removeAgent(agentId);
      } catch (e) {
        console.error('[Settings] Failed to remove agent:', e);
      }
    },
    [config, onConfigChange],
  );

  /** 保存内置 Agent 覆盖（AgentForm 提交）：更新 config.agentOverrides + 后端 add_agent（覆盖层）。 */
  const saveBuiltinOverride = useCallback(
    async (agent: AgentConfig) => {
      const withIdentity: AgentConfig = { ...agent, is_builtin: true };
      const next = { ...(config.agentOverrides || {}), [agent.id]: withIdentity };
      onConfigChange({ ...config, agentOverrides: next });
      try {
        await addAgent(withIdentity);
      } catch (e) {
        console.error('[Settings] Failed to save built-in override:', e);
      }
    },
    [config, onConfigChange],
  );

  /** 重置内置 Agent 覆盖（恢复出厂）：删除 config.agentOverrides 条目 + 后端 remove_agent。 */
  const resetBuiltinOverride = useCallback(
    async (agentId: string) => {
      const next = { ...(config.agentOverrides || {}) };
      delete next[agentId];
      onConfigChange({ ...config, agentOverrides: next });
      try {
        await removeAgent(agentId);
      } catch (e) {
        console.error('[Settings] Failed to reset built-in agent:', e);
      }
    },
    [config, onConfigChange],
  );

  const startEditAgent = (agent: AgentConfig) => {
    const current = config.agentCommandOverrides?.[agent.id] ?? agent.command;
    setEditingPresetId(agent.id);
    setEditingValue(current);
  };

  const saveAgentOverride = (agentId: string) => {
    const trimmed = editingValue.trim();
    const agent = builtinAgents.find((item) => item.id === agentId);
    const defaultCmd = agent?.command ?? '';
    const overrides = { ...(config.agentCommandOverrides || {}) };
    if (trimmed && trimmed !== defaultCmd) {
      overrides[agentId] = trimmed;
    } else {
      delete overrides[agentId];
    }
    onConfigChange({ ...config, agentCommandOverrides: overrides });
    setEditingPresetId(null);
  };

  /** 内置 agent 的有效 command：完整覆盖优先 → 旧 command 覆盖兼容 → 出厂值。 */
  const getEffectiveAgentCommand = (agent: AgentConfig) =>
    config.agentOverrides?.[agent.id]?.command ??
    config.agentCommandOverrides?.[agent.id] ??
    agent.command;

  /** 内置 agent 的有效配置（覆盖层优先，用于设置页展示与 AgentForm 编辑初始值）。 */
  const getEffectiveAgent = (agent: AgentConfig) => config.agentOverrides?.[agent.id] ?? agent;

  const updateAgentSkillPath = async (agent: AgentConfig, newPath: string) => {
    const trimmed = newPath.trim();
    const updated: AgentConfig = {
      ...getEffectiveAgent(agent),
      skill_path: trimmed || undefined,
    };
    if (agent.is_builtin) {
      // 内置：走覆盖层（不污染 customAgents）。
      await saveBuiltinOverride(updated);
      return;
    }
    onConfigChange({
      ...config,
      customAgents: upsertCustomAgent(config.customAgents, updated),
    });
    try {
      await addAgent(updated);
    } catch (e) {
      console.error('[Settings] Failed to update agent:', e);
    }
  };

  const selectSkillPath = async (agent: AgentConfig) => {
    try {
      const selected = await open({ multiple: false, directory: true });
      if (selected && typeof selected === 'string') {
        await updateAgentSkillPath(agent, selected);
      }
    } catch (e) {
      console.error('[Settings] Failed to select skill path:', e);
    }
  };

  const startEditSkillPath = (agentId: string, currentPath: string) => {
    setSkillPathEditingAgentId(agentId);
    setSkillPathInputValue(currentPath);
  };

  const saveSkillPath = async (agent: AgentConfig) => {
    const trimmed = skillPathInputValue.trim();
    if (trimmed !== (agent.skill_path ?? '')) {
      await updateAgentSkillPath(agent, trimmed);
    }
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
    setEditingValue('');
  };

  const getEffectiveCommand = (ide: IdePreset) =>
    config.ideCommandOverrides?.[ide.id] ?? getIdeCommand(ide);

  const isCustomShell =
    shellInput !== '' && !PRESET_SHELLS.some((item) => item.value === shellInput);

  const allFonts = useMemo(
    () =>
      Array.from(new Set([...BUILTIN_FONTS, ...systemFonts])).sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase()),
      ),
    [systemFonts],
  );

  const filteredFonts = useMemo(() => {
    const search = fontSearch.trim().toLowerCase();
    return search ? allFonts.filter((font) => font.toLowerCase().includes(search)) : allFonts;
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
    isCustomShell,
    filteredFonts,
    refreshFonts,

    setAppearanceFontSize,
    setEditorFontSize,
    setTerminalFontSize,
    setDiffMode,
    applyShell,
    applyFont,
    setGpuAcceleration,

    addCustomIde,
    removeCustomIde,
    saveCustomAgent,
    removeCustomAgentById,
    saveBuiltinOverride,
    resetBuiltinOverride,

    startEditAgent,
    saveAgentOverride,
    getEffectiveAgentCommand,
    getEffectiveAgent,

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

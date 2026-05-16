import React, { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import AgentIcon from "./AgentIcon";
import type { AppConfig, AgentConfig } from "../../types";
import { useDockStore } from "../../store/dockStore";

type MenuMode = "none" | "main" | "terminal" | "chat" | "browser";

interface AgentSelectorProps {
  projectId: string;
  currentAgentId: string | null;
  onSelectAgent: (agent: AgentConfig | null) => void;
  /** WSL/SSH 项目传 true，跳过后端 set_project_agent，由外部回调自行持久化 */
  skipBackendPersist?: boolean;
  onShowToast?: (message: string, type?: "info" | "error") => void;
}

interface AgentBarProps {
  agents: AgentConfig[];
  selectedAgentId: string | null;
  installedMap: Map<string, boolean>;
  compactMode: boolean;
  onSelectAgent: (agentId: string) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
}

// Agent Bar Button Component
const AgentBarButton: React.FC<{
  agent: AgentConfig;
  isSelected: boolean;
  isInstalled: boolean;
  compactMode: boolean;
  onClick: () => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
}> = React.memo(({ agent, isSelected, isInstalled, compactMode, onClick, onShowToast }) => {
  const handleClick = useCallback(() => {
    if (!isInstalled) {
      onShowToast?.(`${agent.name} (${agent.command}) is not installed`, "error");
      return;
    }
    if (!agent.enabled) return;
    onClick();
  }, [isInstalled, agent.enabled, agent.name, agent.command, onClick, onShowToast]);

  return (
    <button
      className={`agent-bar-btn ${isSelected ? "selected" : ""} ${!isInstalled ? "not-installed" : ""} ${compactMode ? "compact" : ""}`}
      onClick={handleClick}
      disabled={!agent.enabled}
      title={agent.name}
    >
      <AgentIcon icon={agent.icon} />
      {!compactMode && <span className="agent-bar-btn-name">{agent.name}</span>}
    </button>
  );
});

// Agent Bar Component
const AgentBar: React.FC<AgentBarProps> = React.memo(({ 
  agents, 
  selectedAgentId, 
  installedMap, 
  compactMode, 
  onSelectAgent, 
  onShowToast 
}) => {
  const enabledAgents = agents.filter(a => a.enabled);
  
  if (enabledAgents.length === 0) {
    return (
      <div className="agent-bar-empty">
        <span>No enabled agents</span>
      </div>
    );
  }

  return (
    <div className={`agent-bar ${compactMode ? "compact" : ""}`}>
      {enabledAgents.map(agent => {
        const installed = installedMap.size === 0 || (installedMap.get(agent.id) ?? true);
        return (
          <AgentBarButton
            key={agent.id}
            agent={agent}
            isSelected={selectedAgentId === agent.id}
            isInstalled={installed}
            compactMode={compactMode}
            onClick={() => onSelectAgent(agent.id)}
            onShowToast={onShowToast}
          />
        );
      })}
    </div>
  );
});

// Checkbox Item Component for menu toggles
const MenuCheckboxItem: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}> = React.memo(({ checked, onChange, label }) => {
  const handleClick = useCallback(() => {
    onChange(!checked);
  }, [checked, onChange]);

  return (
    <div className="add-menu-item menu-checkbox-item" onClick={handleClick}>
      <label className="custom-checkbox">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="checkbox-mark" />
      </label>
      <span>{label}</span>
    </div>
  );
});

const AgentSelector: React.FC<AgentSelectorProps> = ({
  projectId,
  currentAgentId,
  onSelectAgent,
  skipBackendPersist = false,
  onShowToast,
}) => {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(currentAgentId);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<MenuMode>("none");
  const [installedMap, setInstalledMap] = useState<Map<string, boolean>>(new Map());
  
  // Config state
  const [showPresetBar, setShowPresetBar] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [hiddenAgentIds, setHiddenAgentIds] = useState<string[]>([]);
  const [configLoaded, setConfigLoaded] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Load agents on mount
  useEffect(() => {
    loadAgents();
  }, []);

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, []);

  // Sync with external currentAgentId
  useEffect(() => {
    setSelectedAgentId(currentAgentId);
  }, [projectId, currentAgentId]);

  // Click outside handler
  useEffect(() => {
    if (!isAddMenuOpen && activeMode === "none") return;
    
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setIsAddMenuOpen(false);
        setActiveMode("none");
      }
    };
    
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isAddMenuOpen, activeMode]);

  // Check installed status when menu opens
  useEffect(() => {
    if (!isAddMenuOpen || agents.length === 0) return;
    const agentIds = agents.map((a) => a.id);
    invoke<Record<string, boolean>>("check_agents_installed", { agentIds })
      .then((result) => {
        setInstalledMap(new Map(Object.entries(result)));
      })
      .catch((err) => {
        console.error("Failed to check agents installed:", err);
      });
  }, [isAddMenuOpen, agents]);

  const loadAgents = async () => {
    try {
      const agentList = await invoke<AgentConfig[]>("list_agents");
      setAgents(agentList);
    } catch (error) {
      console.error("Failed to load agents:", error);
    }
  };

  const loadConfig = async () => {
    try {
      const saved = await invoke<AppConfig>("load_config");
      if (saved && typeof saved === "object") {
        setShowPresetBar(saved.agentSelectorShowPresetBar ?? true);
        setCompactMode(saved.agentSelectorCompactMode ?? false);
        setHiddenAgentIds(Array.isArray(saved.hiddenAgentIds) ? saved.hiddenAgentIds.filter((id: unknown) => typeof id === "string") : []);
      }
    } catch (e) {
      console.error("[AgentSelector] Failed to load config:", e);
    } finally {
      setConfigLoaded(true);
    }
  };

  const saveConfigToBackend = useCallback(async (updates: Partial<AppConfig>) => {
    try {
      const current = await invoke<AppConfig>("load_config");
      const next = { ...current, ...updates };
      await invoke("save_config", { config: next });
    } catch (e) {
      console.error("[AgentSelector] Failed to save config:", e);
    }
  }, []);

  const handleToggleShowPresetBar = useCallback((checked: boolean) => {
    setShowPresetBar(checked);
    saveConfigToBackend({ agentSelectorShowPresetBar: checked });
  }, [saveConfigToBackend]);

  const handleToggleCompactMode = useCallback((checked: boolean) => {
    setCompactMode(checked);
    saveConfigToBackend({ agentSelectorCompactMode: checked });
  }, [saveConfigToBackend]);

  const handleSelectAgent = useCallback(async (agentId: string | null) => {
    if (agentId === selectedAgentId) {
      setIsAddMenuOpen(false);
      setActiveMode("none");
      return;
    }
    setSelectedAgentId(agentId);
    setIsAddMenuOpen(false);
    setActiveMode("none");
    
    if (!skipBackendPersist) {
      try {
        await invoke("set_project_agent", { projectId, agentId });
      } catch (error) {
        console.error("Failed to set agent:", error);
      }
    }
    
    const agent = agentId ? agents.find((a) => a.id === agentId) ?? null : null;
    onSelectAgent(agent);
  }, [selectedAgentId, skipBackendPersist, projectId, agents, onSelectAgent]);

  const handleToggleAddMenu = useCallback(() => {
    setIsAddMenuOpen(prev => !prev);
    if (activeMode !== "none") {
      setActiveMode("none");
    }
  }, [activeMode]);

  const handleSelectMode = useCallback((mode: MenuMode) => {
    if (mode === "chat") {
      onShowToast?.("Coming soon", "info");
      return;
    }
    if (mode === "browser") {
      // Activate Browser dock panel
      useDockStore.getState().togglePanel("browser");
      setIsAddMenuOpen(false);
      return;
    }
    setActiveMode(mode);
    if (mode === "none") {
      setIsAddMenuOpen(false);
    }
  }, [onShowToast]);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const enabledAgents = agents.filter(a => a.enabled && !hiddenAgentIds.includes(a.id));

  return (
    <div className="agent-selector" ref={containerRef}>
      {/* Level 1: Main Display Area */}
      <div className="agent-selector-main">
        {/* Current Agent Display */}
        <div className="agent-current-display">
          {selectedAgent ? (
            <>
              <AgentIcon icon={selectedAgent.icon} />
              <span className="agent-name">{selectedAgent.name}</span>
            </>
          ) : (
            <>
              <AgentIcon icon={null} fallback="⚡" />
              <span className="agent-name">None</span>
            </>
          )}
        </div>

        {/* Add Button */}
        <button
          className={`agent-add-btn ${isAddMenuOpen ? "open" : ""}`}
          onClick={handleToggleAddMenu}
          title="Add or change agent"
        >
          <span className="agent-add-icon">+</span>
        </button>
      </div>

      {/* Level 2: Add Menu Dropdown */}
      {isAddMenuOpen && (
        <div className="agent-add-menu" ref={addMenuRef}>
          {/* Terminal Option */}
          <div
            className={`add-menu-item ${activeMode === "terminal" ? "active" : ""}`}
            onClick={() => handleSelectMode("terminal")}
          >
            <span className="add-menu-icon">⌘</span>
            <span>Terminal</span>
          </div>

          {/* Chat Option (Reserved) */}
          <div
            className={`add-menu-item ${activeMode === "chat" ? "active" : ""}`}
            onClick={() => handleSelectMode("chat")}
          >
            <span className="add-menu-icon">💬</span>
            <span>Chat</span>
            <span className="menu-badge">Soon</span>
          </div>

          {/* Browser Option (Reserved) */}
          <div
            className={`add-menu-item ${activeMode === "browser" ? "active" : ""}`}
            onClick={() => handleSelectMode("browser")}
          >
            <span className="add-menu-icon">🌐</span>
            <span>Browser</span>
          </div>

          <div className="agent-menu-divider" />

          {/* Show Preset Bar Toggle */}
          {configLoaded && (
            <MenuCheckboxItem
              checked={showPresetBar}
              onChange={handleToggleShowPresetBar}
              label="Show Preset Bar"
            />
          )}

          {/* Compact Mode Toggle */}
          {configLoaded && (
            <MenuCheckboxItem
              checked={compactMode}
              onChange={handleToggleCompactMode}
              label="Use Compact Button"
            />
          )}

          {/* Level 3: Agent Bar (shown when Terminal is selected) */}
          {activeMode === "terminal" && showPresetBar && (
            <>
              <div className="agent-menu-divider" />
              <div className="agent-bar-wrapper">
                <AgentBar
                  agents={enabledAgents}
                  selectedAgentId={selectedAgentId}
                  installedMap={installedMap}
                  compactMode={compactMode}
                  onSelectAgent={handleSelectAgent}
                  onShowToast={onShowToast}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* Inline Agent Bar (shown when not in menu but showPresetBar is true) */}
      {showPresetBar && !isAddMenuOpen && enabledAgents.length > 0 && (
        <div className="agent-bar-inline">
          <AgentBar
            agents={enabledAgents}
            selectedAgentId={selectedAgentId}
            installedMap={installedMap}
            compactMode={compactMode}
            onSelectAgent={handleSelectAgent}
            onShowToast={onShowToast}
          />
        </div>
      )}
    </div>
  );
};

export default React.memo(AgentSelector);

import React, { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import AgentIcon from "./AgentIcon";
import type { AgentConfig } from "../../../types";

interface AgentBarProps {
  agents: AgentConfig[];
  selectedAgentId: string | null;
  compactMode?: boolean;
  onSelectAgent: (agentId: string | null) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
}

interface AgentBarButtonProps {
  agent: AgentConfig;
  isSelected: boolean;
  isInstalled: boolean;
  compactMode: boolean;
  onClick: () => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
}

const AgentBarButton: React.FC<AgentBarButtonProps> = React.memo(
  ({ agent, isSelected, isInstalled, compactMode, onClick, onShowToast }) => {
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
  }
);

const AgentBar: React.FC<AgentBarProps> = React.memo(
  ({ agents, selectedAgentId, compactMode = false, onSelectAgent, onShowToast }) => {
    const [installedMap, setInstalledMap] = useState<Map<string, boolean>>(new Map());

    // Check agent installation status
    useEffect(() => {
      if (agents.length === 0) return;
      const agentIds = agents.map((a) => a.id);
      invoke<Record<string, boolean>>("check_agents_installed", { agentIds })
        .then((result) => {
          setInstalledMap(new Map(Object.entries(result)));
        })
        .catch((err) => {
          console.error("[AgentBar] Failed to check agents installed:", err);
        });
    }, [agents]);

    const handleSelectAgent = useCallback(
      (agentId: string | null) => {
        onSelectAgent(agentId);
      },
      [onSelectAgent]
    );

    const enabledAgents = agents.filter((a) => a.enabled);

    if (enabledAgents.length === 0) {
      return (
        <div className="agent-bar-empty">
          <span>No enabled agents</span>
        </div>
      );
    }

    return (
      <div className={`agent-bar ${compactMode ? "compact" : ""}`}>
        {enabledAgents.map((agent) => {
          const installed = installedMap.size === 0 || (installedMap.get(agent.id) ?? true);
          return (
            <AgentBarButton
              key={agent.id}
              agent={agent}
              isSelected={selectedAgentId === agent.id}
              isInstalled={installed}
              compactMode={compactMode}
              onClick={() => handleSelectAgent(agent.id)}
              onShowToast={onShowToast}
            />
          );
        })}
      </div>
    );
  }
);

export default AgentBar;

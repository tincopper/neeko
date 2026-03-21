import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  icon: string | null;
  enabled: boolean;
}

interface AgentSelectorProps {
  projectId: string;
}

const AgentSelector: React.FC<AgentSelectorProps> = ({ projectId }) => {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    loadAgents();
  }, []);

  const loadAgents = async () => {
    try {
      const agentList = await invoke<AgentConfig[]>("list_agents");
      setAgents(agentList);
    } catch (error) {
      console.error("Failed to load agents:", error);
    }
  };

  const handleSelectAgent = async (agentId: string | null) => {
    setSelectedAgentId(agentId);
    try {
      await invoke("set_project_agent", {
        projectId,
        agentId,
      });
    } catch (error) {
      console.error("Failed to set agent:", error);
    }
    setIsOpen(false);
  };

  const getSelectedAgent = (): AgentConfig | undefined => {
    return agents.find((a) => a.id === selectedAgentId);
  };

  return (
    <div className="agent-selector">
      <button
        className="agent-dropdown-btn"
        onClick={() => setIsOpen(!isOpen)}
      >
        {getSelectedAgent() ? (
          <>
            <span className="agent-icon">{getSelectedAgent()?.icon || "🤖"}</span>
            <span className="agent-name">{getSelectedAgent()?.name}</span>
          </>
        ) : (
          <>
            <span className="agent-icon">⚡</span>
            <span className="agent-name">Select Agent</span>
          </>
        )}
        <span className="dropdown-arrow">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className="agent-dropdown">
          <div
            className={`agent-option ${!selectedAgentId ? "selected" : ""}`}
            onClick={() => handleSelectAgent(null)}
          >
            <span className="agent-icon">⚡</span>
            <span className="agent-name">None</span>
          </div>
          {agents.map((agent) => (
            <div
              key={agent.id}
              className={`agent-option ${selectedAgentId === agent.id ? "selected" : ""} ${!agent.enabled ? "disabled" : ""}`}
              onClick={() => agent.enabled && handleSelectAgent(agent.id)}
            >
              <span className="agent-icon">{agent.icon || "🤖"}</span>
              <span className="agent-name">{agent.name}</span>
              <span className="agent-command">{agent.command}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AgentSelector;

import React, { useEffect, useRef, useState } from "react";
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
  currentAgentId: string | null;
  onSelectAgent: (agent: AgentConfig | null) => void;
}

const AgentSelector: React.FC<AgentSelectorProps> = ({
  projectId,
  currentAgentId,
  onSelectAgent,
}) => {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(currentAgentId);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadAgents();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  useEffect(() => {
    setSelectedAgentId(currentAgentId);
  }, [projectId, currentAgentId]);

  const loadAgents = async () => {
    try {
      const agentList = await invoke<AgentConfig[]>("list_agents");
      setAgents(agentList);
    } catch (error) {
      console.error("Failed to load agents:", error);
    }
  };

  const handleSelectAgent = async (agentId: string | null) => {
    if (agentId === selectedAgentId) {
      setIsOpen(false);
      return;
    }
    setSelectedAgentId(agentId);
    setIsOpen(false);
    try {
      await invoke("set_project_agent", { projectId, agentId });
    } catch (error) {
      console.error("Failed to set agent:", error);
    }
    const agent = agentId ? agents.find((a) => a.id === agentId) ?? null : null;
    onSelectAgent(agent);
  };

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  return (
    <div className="agent-selector" ref={containerRef}>
      <button
        className="agent-dropdown-btn"
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedAgent ? (
          <>
            <span className="agent-icon">{selectedAgent.icon || "🤖"}</span>
            <span className="agent-name">{selectedAgent.name}</span>
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

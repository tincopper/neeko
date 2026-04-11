import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import AgentIcon from "./AgentIcon";

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
  /** WSL/SSH 项目传 true，跳过后端 set_project_agent，由外部回调自行持久化 */
  skipBackendPersist?: boolean;
  onShowToast?: (message: string, type?: "info" | "error") => void;
}

const AgentSelector: React.FC<AgentSelectorProps> = ({
  projectId,
  currentAgentId,
  onSelectAgent,
  skipBackendPersist = false,
  onShowToast,
}) => {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(currentAgentId);
  const [isOpen, setIsOpen] = useState(false);
  const [installedMap, setInstalledMap] = useState<Map<string, boolean>>(new Map());
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

  useEffect(() => {
    if (!isOpen || agents.length === 0) return;
    const agentIds = agents.map((a) => a.id);
    invoke<Record<string, boolean>>("check_agents_installed", { agentIds })
      .then((result) => {
        setInstalledMap(new Map(Object.entries(result)));
      })
      .catch((err) => {
        console.error("Failed to check agents installed:", err);
      });
  }, [isOpen, agents]);

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
    if (!skipBackendPersist) {
      try {
        await invoke("set_project_agent", { projectId, agentId });
      } catch (error) {
        console.error("Failed to set agent:", error);
      }
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
            <AgentIcon icon={selectedAgent.icon} />
            <span className="agent-name">{selectedAgent.name}</span>
          </>
        ) : (
          <>
            <AgentIcon icon={null} fallback="⚡" />
            <span className="agent-name">Select Agent</span>
          </>
        )}
        <span className="dropdown-arrow">{isOpen ? "−" : "+"}</span>
      </button>

      {isOpen && (
        <div className="agent-dropdown">
          <div
            className={`agent-option ${!selectedAgentId ? "selected" : ""}`}
            onClick={() => handleSelectAgent(null)}
          >
            <AgentIcon icon={null} fallback="⚡" />
            <span className="agent-name">None</span>
          </div>
          {agents.map((agent) => {
            const installed = installedMap.size === 0 || (installedMap.get(agent.id) ?? true);
            const handleClick = () => {
              if (!installed) {
                onShowToast?.(agent.name + " (" + agent.command + ") is not installed", "error");
                return;
              }
              if (agent.enabled) handleSelectAgent(agent.id);
            };
            return (
              <div
                key={agent.id}
                className={`agent-option ${selectedAgentId === agent.id ? "selected" : ""} ${!agent.enabled ? "disabled" : ""} ${!installed ? "not-installed" : ""}`}
                onClick={handleClick}
              >
                <AgentIcon icon={agent.icon} />
                <span className="agent-name">{agent.name}</span>
                <span className="agent-command">{agent.command}</span>
                {installedMap.size > 0 && (
                  <span className={`agent-status-dot ${installed ? "installed-dot" : "not-installed-dot"}`} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default React.memo(AgentSelector);

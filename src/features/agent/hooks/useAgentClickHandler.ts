import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentConfig } from "../../../types";
import type { TerminalTab } from "../../../types/terminal";

interface UseAgentClickHandlerOptions {
  tabKey: string | null;
  handleTabAgentClick: (tabKey: string, agent: AgentConfig) => TerminalTab | null;
  activeProject: { id: string } | null;
  activeWslProject: { project: { id: string } } | null;
  activeRemoteProject: { project: { id: string } } | null;
  agentActions: {
    handleSelectLocalAgent: (agent: AgentConfig, cacheKey: string) => void;
  };
  wslActions: {
    updateWslProjectAgent: (agent: AgentConfig) => void;
    handleSelectWslAgent: (agent: AgentConfig) => void;
  };
  remoteActions: {
    updateRemoteProjectAgent: (agent: AgentConfig) => void;
    handleSelectRemoteAgent: (agent: AgentConfig) => void;
  };
}

export function useAgentClickHandler(options: UseAgentClickHandlerOptions) {
  const {
    tabKey,
    handleTabAgentClick,
    activeProject,
    activeWslProject,
    activeRemoteProject,
    agentActions,
    wslActions,
    remoteActions,
  } = options;

  const handleAgentClick = useCallback(
    (agent: AgentConfig) => {
      if (!tabKey) return;
      const newTab = handleTabAgentClick(tabKey, agent);

      if (activeProject) {
        invoke("set_project_agent", {
          projectId: activeProject.id,
          agentId: agent.id,
        }).catch((err: unknown) => {
          console.error("[TitleBar] Failed to set agent:", err);
        });
        if (!newTab) {
          const cacheKey = `${activeProject.id}:1`;
          agentActions.handleSelectLocalAgent(agent, cacheKey);
        }
      } else if (activeWslProject) {
        if (newTab) {
          wslActions.updateWslProjectAgent(agent);
        } else {
          wslActions.handleSelectWslAgent(agent);
        }
      } else if (activeRemoteProject) {
        if (newTab) {
          remoteActions.updateRemoteProjectAgent(agent);
        } else {
          remoteActions.handleSelectRemoteAgent(agent);
        }
      }
    },
    [
      tabKey,
      handleTabAgentClick,
      activeProject,
      activeWslProject,
      activeRemoteProject,
      agentActions,
      wslActions,
      remoteActions,
    ],
  );

  return { handleAgentClick };
}

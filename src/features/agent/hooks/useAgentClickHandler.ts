import { useCallback } from "react";
import { setProjectAgent } from "../api/agentApi";
import { useProjectStore } from '@/features/project/store';
import type { AgentConfig } from '@/shared/types';
import type { TerminalTab } from '@/shared/types/terminal';

interface UseAgentClickHandlerOptions {
  tabKey: string | null;
  handleTabAgentClick: (tabKey: string, agent: AgentConfig) => TerminalTab | null;
  activeProject: { id: string } | null;
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
    agentActions,
    wslActions,
    remoteActions,
  } = options;

  const handleAgentClick = useCallback(
    (agent: AgentConfig) => {
      if (!tabKey) return;
      const newTab = handleTabAgentClick(tabKey, agent);

      const fullProject = useProjectStore.getState().activeProject;

      if (fullProject?.environment.type === 'Wsl') {
        if (newTab) {
          wslActions.updateWslProjectAgent(agent);
        } else {
          wslActions.handleSelectWslAgent(agent);
        }
      } else if (fullProject?.environment.type === 'Remote') {
        if (newTab) {
          remoteActions.updateRemoteProjectAgent(agent);
        } else {
          remoteActions.handleSelectRemoteAgent(agent);
        }
      } else if (activeProject) {
        setProjectAgent(activeProject.id, agent.id).catch((err: unknown) => {
          console.error("[TitleBar] Failed to set agent:", err);
        });
        if (!newTab) {
          const cacheKey = `${activeProject.id}:1`;
          agentActions.handleSelectLocalAgent(agent, cacheKey);
        }
      }
    },
    [
      tabKey,
      handleTabAgentClick,
      activeProject,
      agentActions,
      wslActions,
      remoteActions,
    ],
  );

  return { handleAgentClick };
}

import { useCallback } from "react";
import { useAgentActions } from "@/features/agent/hooks/useAgentActions";
import { useAgentClickHandler } from "@/features/agent/hooks/useAgentClickHandler";
import type { AgentConfig } from "@/types/agent";
import type { SaveSessionFn } from "@/features/connection/hooks/useWslProjects";
import type { AppConfig } from "@/types/app";
import type { TerminalTab } from "@/types/terminal";

interface UseAgentOrchestratorParams {
  config: AppConfig;
  showToast: (message: string, type?: "info" | "error") => void;
  saveSession: SaveSessionFn;
  handleOpenIde: (project: { id: string; selected_ide: string | null }) => Promise<void>;
  tabKey: string | null;
  handleTabAgentClick: (tabKey: string, agent: AgentConfig) => TerminalTab | null;
  activeProject: { id: string } | null;
  activeWslProject: { project: { id: string } } | null;
  activeRemoteProject: { project: { id: string } } | null;
  wslActions: Parameters<typeof useAgentClickHandler>[0]["wslActions"];
  remoteActions: Parameters<typeof useAgentClickHandler>[0]["remoteActions"];
  saveConfig: (config: AppConfig) => void;
}

export function useAgentOrchestrator(params: UseAgentOrchestratorParams) {
  const { config, showToast, saveSession, handleOpenIde, tabKey, handleTabAgentClick, activeProject, activeWslProject, activeRemoteProject, wslActions, remoteActions, saveConfig } = params;

  const agentActions = useAgentActions({
    terminal: { fontSize: config.terminalFontSize ?? 14, shell: config.shell ?? "", fontFamily: config.fontFamily ?? "", gpuAcceleration: config.terminalGpuAcceleration ?? false },
    agentCommandOverrides: config.agentCommandOverrides, handleOpenIde, showToast, saveSession,
  });

  const { handleAgentClick } = useAgentClickHandler({ tabKey, handleTabAgentClick, activeProject, activeWslProject, activeRemoteProject, agentActions, wslActions, remoteActions });

  const handleToggleHiddenAgent = useCallback(
    (agentId: string) => {
      const current = config.hiddenAgentIds ?? [];
      const next = current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId];
      saveConfig({ ...config, hiddenAgentIds: next });
    },
    [config, saveConfig],
  );

  return { agentActions, handleAgentClick, handleToggleHiddenAgent };
}

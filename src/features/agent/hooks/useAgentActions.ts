import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { refreshTerminal, switchAgentInTerminal } from "../../../components/terminal";
import { useProjectStore } from "../../../store/projectStore";
import { useConnectionStore } from "../../../store/connectionStore";
import type { AgentConfig } from "../../../types";
import type { SaveSessionFn } from "../../../hooks/useWslProjects";

interface TerminalSettings {
  fontSize: number;
  shell: string;
  fontFamily: string;
  gpuAcceleration: boolean;
}

interface UseAgentActionsParams {
  terminal: TerminalSettings;
  agentCommandOverrides?: Record<string, string>;
  handleOpenIde: (project: { id: string; selected_ide: string | null }) => Promise<void>;
  showToast: (message: string, type?: "info" | "error") => void;
  saveSession: SaveSessionFn;
}

interface UseAgentActionsResult {
  handleSelectLocalAgent: (agent: AgentConfig | null, cacheKey: string) => void;
  handleOpenIdeCallback: (project: { id: string; selected_ide: string | null }) => void;
  handleOpenIdeForSidebar: (projectId: string) => void;
  handleSaveProjectSettings: (
    projectId: string,
    agentId: string | null,
    ideCommand: string | null,
  ) => Promise<void>;
  handleSetProjectIde: (projectId: string, ideCommand: string | null) => void;
}

export function useAgentActions({
  terminal,
  agentCommandOverrides,
  handleOpenIde,
  showToast,
  saveSession,
}: UseAgentActionsParams): UseAgentActionsResult {
  const projects = useProjectStore((state) => state.projects);

  const handleSelectLocalAgent = useCallback((agent: AgentConfig | null, cacheKey: string) => {
    const snapshot = useProjectStore.getState();
    const currentActiveProject = snapshot.activeProject;
    if (!currentActiveProject) {
      return;
    }

    const agentId = agent?.id ?? null;
    useProjectStore.setState((state) => {
      const nextProjects = state.projects.map((project) => (
        project.id === currentActiveProject.id
          ? { ...project, selected_agent: agentId }
          : project
      ));

      const nextActiveProject = state.activeProject && state.activeProject.id === currentActiveProject.id
        ? { ...state.activeProject, selected_agent: agentId }
        : state.activeProject;

      return {
        projects: nextProjects,
        activeProject: nextActiveProject,
      };
    });

    if (agent) {
      void switchAgentInTerminal(
        cacheKey,
        currentActiveProject.path,
        currentActiveProject.name,
        agent.id,
        terminal.fontSize,
        terminal.shell,
        terminal.fontFamily,
        currentActiveProject.id,
        agentCommandOverrides,
        terminal.gpuAcceleration,
      );
      return;
    }

    setTimeout(() => refreshTerminal(currentActiveProject.id), 50);
  }, [agentCommandOverrides, terminal.fontFamily, terminal.fontSize, terminal.shell, terminal.gpuAcceleration]);

  const handleOpenIdeCallback = useCallback((project: { id: string; selected_ide: string | null }) => {
    if (!project.selected_ide) {
      showToast("No IDE configured for this project", "error");
      return;
    }

    showToast(`Opening ${project.selected_ide}...`, "info");
    handleOpenIde(project).catch((error: unknown) => {
      showToast(String(error), "error");
    });
  }, [handleOpenIde, showToast]);

  const handleOpenIdeForSidebar = useCallback((projectId: string) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }
    handleOpenIdeCallback(project);
  }, [projects, handleOpenIdeCallback]);

  const handleSaveProjectSettings = useCallback(async (
    projectId: string,
    agentId: string | null,
    ideCommand: string | null,
  ) => {
    useProjectStore.setState((state) => {
      const nextProjects = state.projects.map((project) => (
        project.id === projectId
          ? {
              ...project,
              selected_agent: agentId,
              selected_ide: ideCommand,
            }
          : project
      ));

      const nextActiveProject = state.activeProject && state.activeProject.id === projectId
        ? {
            ...state.activeProject,
            selected_agent: agentId,
            selected_ide: ideCommand,
          }
        : state.activeProject;

      return {
        projects: nextProjects,
        activeProject: nextActiveProject,
      };
    });

    try {
      await saveSession();
    } catch (error) {
      console.error("Failed to save session after project settings change:", error);
    }
  }, [saveSession]);

  /**
   * 把指定 IDE 设为某项目的默认 IDE，但不打开。
   * 同步更新 local / wsl / remote 三种项目数组的 selected_ide，
   * 触发 saveSession 写盘，本地项目额外 invoke set_project_ide 让后端 manager 同步。
   */
  const handleSetProjectIde = useCallback(
    (projectId: string, ideCommand: string | null) => {
      useProjectStore.setState((state) => {
        const nextProjects = state.projects.map((p) =>
          p.id === projectId ? { ...p, selected_ide: ideCommand } : p,
        );
        const nextActiveProject =
          state.activeProject && state.activeProject.id === projectId
            ? { ...state.activeProject, selected_ide: ideCommand }
            : state.activeProject;

        return {
          projects: nextProjects,
          activeProject: nextActiveProject,
        };
      });

      useConnectionStore.setState((state) => {
        const nextWslEntries = state.wslEntries.map((entry) => ({
          ...entry,
          projects: entry.projects.map((p) =>
            p.id === projectId ? { ...p, selected_ide: ideCommand } : p,
          ),
        }));
        const nextActiveWslProject =
          state.activeWslProject && state.activeWslProject.project.id === projectId
            ? {
                ...state.activeWslProject,
                project: { ...state.activeWslProject.project, selected_ide: ideCommand },
              }
            : state.activeWslProject;

        const nextRemoteEntries = state.remoteEntries.map((entry) => ({
          ...entry,
          projects: entry.projects.map((p) =>
            p.id === projectId ? { ...p, selected_ide: ideCommand } : p,
          ),
        }));
        const nextActiveRemoteProject =
          state.activeRemoteProject && state.activeRemoteProject.project.id === projectId
            ? {
                ...state.activeRemoteProject,
                project: { ...state.activeRemoteProject.project, selected_ide: ideCommand },
              }
            : state.activeRemoteProject;

        return {
          wslEntries: nextWslEntries,
          activeWslProject: nextActiveWslProject,
          remoteEntries: nextRemoteEntries,
          activeRemoteProject: nextActiveRemoteProject,
        };
      });

      // 本地项目同步后端 project_manager；WSL/SSH 项目命中不到也不报错。
      invoke("set_project_ide", { projectId, ide: ideCommand }).catch(() => {
        // ignore: WSL/remote projects are not tracked by local project_manager
      });

      saveSession().catch((error) => {
        console.error("Failed to save session after IDE selection:", error);
      });
    },
    [saveSession],
  );

  return {
    handleSelectLocalAgent,
    handleOpenIdeCallback,
    handleOpenIdeForSidebar,
    handleSaveProjectSettings,
    handleSetProjectIde,
  };
}

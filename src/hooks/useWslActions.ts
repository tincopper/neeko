import { useCallback, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  refreshWslTerminal,
  switchAgentInWslTerminal,
  wslCacheKey,
} from "../components/terminal";
import { useAppStore } from "../store/appStore";
import type {
  AgentConfig,
  AppConfig,
  GitInfo,
  WSLProject,
  WSLEntrySession,
} from "../types";
import { buildRefreshGitHandler, updateProjectInEntries } from "../utils/entryUpdates";
import { useConnectionWorktreeState } from "./useConnectionWorktreeState";
import type { SaveSessionFn } from "./useWslProjects";

interface UseWslActionsParams {
  config: AppConfig;
  showToast: (message: string, type?: "info" | "error") => void;
  saveSession: SaveSessionFn;
}

type WslDiffState = {
  distro: string;
  projectPath: string;
  filePath: string;
};

export function useWslActions({
  config,
  showToast,
  saveSession,
}: UseWslActionsParams) {
  const wslEntries = useAppStore((state) => state.wslEntries);
  const activeWslProject = useAppStore((state) => state.activeWslProject);

  const setWslEntries: Dispatch<SetStateAction<WSLEntrySession[]>> = useCallback((updater) => {
    useAppStore.setState((state) => ({
      wslEntries: typeof updater === "function" ? updater(state.wslEntries) : updater,
    }));
  }, []);

  const setActiveWslProject: Dispatch<SetStateAction<{ distro: string; project: WSLProject } | null>> = useCallback((updater) => {
    useAppStore.setState((state) => ({
      activeWslProject: typeof updater === "function" ? updater(state.activeWslProject) : updater,
    }));
  }, []);

  const worktreeState = useConnectionWorktreeState<WslDiffState>();
  const {
    diffState: wslDiffState,
    setDiffState: setWslDiffState,
    activeWorktreePath: activeWslWorktreePath,
    setActiveWorktreePath: setActiveWslWorktreePath,
    activeWorktreeBranch: wslActiveWtBranch,
    setActiveWorktreeBranch: setWslActiveWtBranch,
    openedWorktrees: wslOpenedWt,
    setOpenedWorktrees: setWslOpenedWt,
    openWorktreeTerminal,
    resetConnectionState,
  } = worktreeState;

  const refreshWslGit = useMemo(() => buildRefreshGitHandler<
    WSLProject,
    WSLEntrySession,
    { distro: string; project: WSLProject },
    string
  >({
    refreshGitInfo: async (projectPath, distro) => (
      invoke<GitInfo>("refresh_wsl_git_info", { distro, projectPath }).catch(() => null)
    ),
    setEntries: setWslEntries,
    setActiveProject: setActiveWslProject,
    isActiveProject: (activeProject, projectId) => activeProject.project.id === projectId,
    updateActiveProject: (activeProject, gitInfo) => ({
      ...activeProject,
      project: {
        ...activeProject.project,
        git_info: gitInfo,
      },
    }),
  }), [setWslEntries, setActiveWslProject]);

  const handleSelectWslProject = useCallback((distro: string, project: WSLProject) => {
    useAppStore.setState({
      activeProjectId: null,
      activeProject: null,
      activeWslKey: { distro, projectId: project.id },
      activeWslProject: { distro, project },
      activeRemoteKey: null,
      activeRemoteProject: null,
    });
    resetConnectionState();
    void refreshWslGit(distro, project.id, project.path);
  }, [resetConnectionState, refreshWslGit]);

  const handleSelectWslFile = useCallback((distro: string, projectPath: string, filePath: string) => {
    setWslDiffState({ distro, projectPath, filePath });
  }, [setWslDiffState]);

  const handleRefreshWslGit = useCallback(async (
    distro: string,
    projectId: string,
    projectPath: string,
  ) => {
    await refreshWslGit(distro, projectId, projectPath);
  }, [refreshWslGit]);

  const handleOpenWslIde = useCallback((distro: string, projectPath: string, ide: string) => {
    if (!ide) {
      showToast("No IDE selected for this project", "error");
      return;
    }
    invoke("open_wsl_ide", { distro, projectPath, ide }).catch((error) => {
      showToast(String(error), "error");
    });
  }, [showToast]);

  const handleOpenWslWorktreeTerminal = useCallback((
    _distro: string,
    worktreePath: string,
    branch: string,
  ) => {
    openWorktreeTerminal(worktreePath, branch);
  }, [openWorktreeTerminal]);

  const handleSelectWslAgent = useCallback((agent: AgentConfig | null) => {
    if (!activeWslProject) {
      return;
    }

    const cacheKey = wslCacheKey(activeWslProject.distro, activeWslProject.project.id);
    if (agent) {
      void switchAgentInWslTerminal(
        cacheKey,
        activeWslProject.distro,
        activeWslProject.project.path,
        activeWslProject.project.name,
        agent.id,
        config.terminalFontSize ?? 14,
        config.fontFamily ?? "",
        config.agentCommandOverrides,
      );
    }

    const agentId = agent?.id ?? null;
    const nextEntries = updateProjectInEntries(
      wslEntries,
      activeWslProject.project.id,
      (project) => ({ ...project, selected_agent: agentId }),
    );
    setWslEntries(nextEntries);
    setActiveWslProject((prev) => (
      prev ? {
        ...prev,
        project: { ...prev.project, selected_agent: agentId },
      } : prev
    ));

    if (!agent) {
      setTimeout(() => refreshWslTerminal(cacheKey), 50);
    }

    saveSession(nextEntries, undefined).catch(console.error);
  }, [activeWslProject, config, saveSession, setActiveWslProject, setWslEntries, wslEntries]);

  return {
    wslDiffState,
    setWslDiffState,
    activeWslWorktreePath,
    setActiveWslWorktreePath,
    wslActiveWtBranch,
    setWslActiveWtBranch,
    wslOpenedWt,
    setWslOpenedWt,
    handleSelectWslProject,
    handleSelectWslFile,
    handleRefreshWslGit,
    handleOpenWslIde,
    handleOpenWslWorktreeTerminal,
    handleSelectWslAgent,
  };
}

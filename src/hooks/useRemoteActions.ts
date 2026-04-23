import { useCallback, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  refreshRemoteTerminal,
  remoteCacheKey,
  switchAgentInRemoteTerminal,
} from "../components/terminal";
import { useAppStore } from "../store/appStore";
import type {
  AgentConfig,
  AppConfig,
  AuthMethod,
  GitInfo,
  RemoteEntrySession,
  RemoteProject,
} from "../types";
import { buildRefreshGitHandler, updateProjectInEntries } from "../utils/entryUpdates";
import { useConnectionWorktreeState } from "./useConnectionWorktreeState";
import type { SaveSessionFn } from "./useWslProjects";

interface UseRemoteActionsParams {
  config: AppConfig;
  showToast: (message: string, type?: "info" | "error") => void;
  saveSession: SaveSessionFn;
}

type RemoteDiffState = {
  entryId: string;
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
  projectPath: string;
  filePath: string;
};

export function useRemoteActions({
  config,
  showToast,
  saveSession,
}: UseRemoteActionsParams) {
  const remoteEntries = useAppStore((state) => state.remoteEntries);
  const activeRemoteProject = useAppStore((state) => state.activeRemoteProject);
  const remoteAuthStore = useAppStore((state) => state.remoteAuthStore);

  const setRemoteEntries: Dispatch<SetStateAction<RemoteEntrySession[]>> = useCallback((updater) => {
    useAppStore.setState((state) => ({
      remoteEntries: typeof updater === "function" ? updater(state.remoteEntries) : updater,
    }));
  }, []);

  const setActiveRemoteProject: Dispatch<SetStateAction<{
    entry: RemoteEntrySession;
    project: RemoteProject;
  } | null>> = useCallback((updater) => {
    useAppStore.setState((state) => ({
      activeRemoteProject: typeof updater === "function" ? updater(state.activeRemoteProject) : updater,
    }));
  }, []);

  const worktreeState = useConnectionWorktreeState<RemoteDiffState>();
  const {
    diffState: remoteDiffState,
    setDiffState: setRemoteDiffState,
    activeWorktreePath: activeRemoteWorktreePath,
    setActiveWorktreePath: setActiveRemoteWorktreePath,
    activeWorktreeBranch: remoteActiveWtBranch,
    setActiveWorktreeBranch: setRemoteActiveWtBranch,
    openedWorktrees: remoteOpenedWt,
    setOpenedWorktrees: setRemoteOpenedWt,
    openWorktreeTerminal,
    resetConnectionState,
  } = worktreeState;

  const invokeRemoteGit = useCallback(
    async (command: string, entryId: string, extra: Record<string, unknown>): Promise<unknown> => {
      const entry = remoteEntries.find((item) => item.id === entryId);
      const auth = remoteAuthStore.get(entryId);
      if (!entry || !auth) {
        throw new Error("No auth for entry");
      }
      return invoke(command, {
        host: entry.host,
        port: entry.port,
        username: entry.username,
        auth,
        ...extra,
      });
    },
    [remoteEntries, remoteAuthStore],
  );

  const refreshRemoteGit = useMemo(() => buildRefreshGitHandler<
    RemoteProject,
    RemoteEntrySession,
    { entry: RemoteEntrySession; project: RemoteProject },
    string
  >({
    refreshGitInfo: async (projectPath, entryId) => {
      const result = await invokeRemoteGit(
        "refresh_remote_git_info",
        entryId,
        { projectPath },
      ).catch((e) => {
        console.error("[SSH] Failed to refresh git info:", e);
        return null;
      });
      return result as GitInfo | null;
    },
    setEntries: setRemoteEntries,
    setActiveProject: setActiveRemoteProject,
    isActiveProject: (activeProject, projectId) => activeProject.project.id === projectId,
    updateActiveProject: (activeProject, gitInfo) => ({
      ...activeProject,
      project: {
        ...activeProject.project,
        git_info: gitInfo,
      },
    }),
  }), [invokeRemoteGit, setRemoteEntries, setActiveRemoteProject]);

  const handleSelectRemoteProject = useCallback((host: string, project: RemoteProject) => {
    useAppStore.setState({
      activeProjectId: null,
      activeProject: null,
      activeWslKey: null,
      activeWslProject: null,
      activeRemoteKey: { host, projectId: project.id },
    });
    resetConnectionState();

    const entry = remoteEntries.find((item) => item.host === host);
    if (!entry) {
      setActiveRemoteProject(null);
      return;
    }

    setActiveRemoteProject({ entry, project });
    if (remoteAuthStore.has(entry.id)) {
      void refreshRemoteGit(entry.id, project.id, project.path);
    }
  }, [remoteEntries, remoteAuthStore, resetConnectionState, setActiveRemoteProject, refreshRemoteGit]);

  const handleSelectRemoteFile = useCallback((
    entryId: string,
    projectPath: string,
    filePath: string,
  ) => {
    const entry = remoteEntries.find((item) => item.id === entryId);
    const auth = remoteAuthStore.get(entryId);
    if (!entry || !auth) {
      return;
    }
    setRemoteDiffState({
      entryId,
      host: entry.host,
      port: entry.port,
      username: entry.username,
      auth,
      projectPath,
      filePath,
    });
  }, [remoteEntries, remoteAuthStore, setRemoteDiffState]);

  const handleRefreshRemoteGit = useCallback(async (
    entryId: string,
    projectId: string,
    projectPath: string,
  ) => {
    await refreshRemoteGit(entryId, projectId, projectPath);
  }, [refreshRemoteGit]);

  const handleOpenRemoteIde = useCallback((entryId: string, projectPath: string, ide: string) => {
    if (!ide) {
      showToast("No IDE selected for this project", "error");
      return;
    }

    const entry = remoteEntries.find((item) => item.id === entryId);
    if (!entry) {
      return;
    }

    invoke("open_remote_ide", {
      host: entry.host,
      port: entry.port,
      username: entry.username,
      projectPath,
      ide,
    }).catch((error) => {
      showToast(String(error), "error");
    });
  }, [remoteEntries, showToast]);

  const handleOpenRemoteWorktreeTerminal = useCallback((
    _entryId: string,
    worktreePath: string,
    branch: string,
  ) => {
    openWorktreeTerminal(worktreePath, branch);
  }, [openWorktreeTerminal]);

  const handleSelectRemoteAgent = useCallback((agent: AgentConfig | null) => {
    if (!activeRemoteProject) {
      return;
    }

    const cacheKey = remoteCacheKey(
      activeRemoteProject.entry.id,
      activeRemoteProject.project.id,
    );
    if (agent) {
      void switchAgentInRemoteTerminal(
        cacheKey,
        agent.id,
        config.agentCommandOverrides,
      );
    }

    const agentId = agent?.id ?? null;
    const nextEntries = updateProjectInEntries(
      remoteEntries,
      activeRemoteProject.project.id,
      (project) => ({ ...project, selected_agent: agentId }),
    );
    setRemoteEntries(nextEntries);
    setActiveRemoteProject((prev) => (
      prev ? {
        ...prev,
        project: { ...prev.project, selected_agent: agentId },
      } : prev
    ));

    if (!agent) {
      setTimeout(() => refreshRemoteTerminal(cacheKey), 50);
    }

    saveSession(undefined, nextEntries).catch(console.error);
  }, [activeRemoteProject, config.agentCommandOverrides, remoteEntries, saveSession, setActiveRemoteProject, setRemoteEntries]);

  return {
    remoteDiffState,
    setRemoteDiffState,
    activeRemoteWorktreePath,
    setActiveRemoteWorktreePath,
    remoteActiveWtBranch,
    setRemoteActiveWtBranch,
    remoteOpenedWt,
    setRemoteOpenedWt,
    invokeRemoteGit,
    handleSelectRemoteProject,
    handleSelectRemoteFile,
    handleRefreshRemoteGit,
    handleOpenRemoteIde,
    handleOpenRemoteWorktreeTerminal,
    handleSelectRemoteAgent,
  };
}

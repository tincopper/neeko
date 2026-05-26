import { useCallback, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  refreshRemoteTerminal,
  remoteCacheKey,
  switchAgentInRemoteTerminal,
} from "../components/terminal";
import { useAppStore } from "../store/appStore";
import { useShallow } from "zustand/shallow";
import type {
  AgentConfig,
  AppConfig,
  GitInfo,
  RemoteEntrySession,
  RemoteProject,
} from "../types";
import { buildRefreshGitHandler, updateProjectInEntries } from "../utils/entryUpdates";
import type { SaveSessionFn } from "./useWslProjects";
import type { WorktreeItem } from "./useWorktreeState";

interface UseRemoteActionsParams {
  config: AppConfig;
  showToast: (message: string, type?: "info" | "error") => void;
  saveSession: SaveSessionFn;
}



export function useRemoteActions({
  config,
  showToast,
  saveSession,
}: UseRemoteActionsParams) {
  const remoteEntries = useAppStore(useShallow((state) => state.remoteEntries));
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

  // ── Remote transient worktree state ──
  // activeWorktreePath / activeWorktreeBranch / openedWorktrees live in appStore
  // to avoid useState → useSyncToStore double-render and enable merged setState.
  const activeRemoteWorktreePath = useAppStore((s) => s.activeRemoteWorktreePath);
  const remoteActiveWtBranch = useAppStore((s) => s.remoteActiveWtBranch);
  const remoteOpenedWt = useAppStore((s) => s.remoteOpenedWt);



  const setActiveRemoteWorktreePath = useCallback((path: string | null) => {
    useAppStore.setState({ activeRemoteWorktreePath: path });
  }, []);

  const setRemoteActiveWtBranch = useCallback((branch: string) => {
    useAppStore.setState({ remoteActiveWtBranch: branch });
  }, []);

  const setRemoteOpenedWt: Dispatch<SetStateAction<WorktreeItem[]>> = useCallback((updater) => {
    useAppStore.setState((state) => ({
      remoteOpenedWt: typeof updater === "function" ? updater(state.remoteOpenedWt) : updater,
    }));
  }, []);

  const openWorktreeTerminal = useCallback((worktreePath: string, branch: string) => {
    setActiveRemoteWorktreePath(worktreePath);
    setRemoteActiveWtBranch(branch);
    setRemoteOpenedWt((prev) =>
      prev.some((item) => item.path === worktreePath)
        ? prev
        : [...prev, { path: worktreePath, branch }],
    );
  }, [setActiveRemoteWorktreePath, setRemoteActiveWtBranch, setRemoteOpenedWt]);

  const resetRemoteTransientState = useCallback(() => {
    useAppStore.setState({
      activeRemoteWorktreePath: null,
      remoteActiveWtBranch: "",
      remoteOpenedWt: [],
    });
  }, []);

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
    resetRemoteTransientState();

    const entry = remoteEntries.find((item) => item.host === host);
    if (!entry) {
      setActiveRemoteProject(null);
      return;
    }

    setActiveRemoteProject({ entry, project });
    if (remoteAuthStore.has(entry.id)) {
      void refreshRemoteGit(entry.id, project.id, project.path);
    }
  }, [remoteEntries, remoteAuthStore, resetRemoteTransientState, setActiveRemoteProject, refreshRemoteGit]);



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

  const updateRemoteProjectAgent = useCallback((agent: AgentConfig | null) => {
    if (!activeRemoteProject) return;

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
    saveSession(undefined, nextEntries).catch(console.error);
  }, [activeRemoteProject, remoteEntries, saveSession, setActiveRemoteProject, setRemoteEntries]);

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

    updateRemoteProjectAgent(agent);

    if (!agent) {
      setTimeout(() => refreshRemoteTerminal(cacheKey), 50);
    }
  }, [activeRemoteProject, config.agentCommandOverrides, updateRemoteProjectAgent]);

  return {
    activeRemoteWorktreePath,
    setActiveRemoteWorktreePath,
    remoteActiveWtBranch,
    setRemoteActiveWtBranch,
    remoteOpenedWt,
    setRemoteOpenedWt,
    resetRemoteTransientState,
    invokeRemoteGit,
    handleSelectRemoteProject,
    handleRefreshRemoteGit,
    handleOpenRemoteIde,
    handleOpenRemoteWorktreeTerminal,
    handleSelectRemoteAgent,
    updateRemoteProjectAgent,
  };
}

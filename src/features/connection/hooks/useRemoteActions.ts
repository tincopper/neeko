import { useCallback, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { openRemoteIde } from "../../project/api/projectApi";
import { invokeRemoteGitCommand } from "../api/connectionApi";
import { getGitInfo } from "@/features/git/api/gitApi";
import {
  refreshRemoteTerminal,
  remoteCacheKey,
  switchAgentInRemoteTerminal,
} from "@/features/terminal/components/terminalCache";
import { useConnectionStore } from "../store";
import { useProjectStore } from '@/features/project/store';
import { useWorktreeStore } from '@/features/project/worktreeStore';
import { useShallow } from "zustand/shallow";
import type {
  AgentConfig,
  AppConfig,
  RemoteEntrySession,
} from '@/shared/types';
import { updateProjectInEntries } from '@/shared/utils/entryUpdates';
import type { SaveSessionFn } from "./useWslProjects";
import type { WorktreeItem } from "@/features/project/hooks/useWorktreeState";

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
  const remoteEntries = useConnectionStore(useShallow((state) => state.remoteEntries));
  const remoteAuthStore = useConnectionStore((state) => state.remoteAuthStore);

  const setRemoteEntries: Dispatch<SetStateAction<RemoteEntrySession[]>> = useCallback((updater) => {
    useConnectionStore.setState((state) => ({
      remoteEntries: typeof updater === "function" ? updater(state.remoteEntries) : updater,
    }));
  }, []);

  // ── Remote transient worktree state ──
  // Uses unified activeWorktreePath for path; Remote-specific branch/opened
  // remain separate until Remote fully migrates to worktreeStateMap.
  const unifiedActiveWtPath = useWorktreeStore((s) => s.activeWorktreePath);
  const remoteActiveWtBranch = useWorktreeStore((s) => s.remoteActiveWtBranch);
  const remoteOpenedWt = useWorktreeStore((s) => s.remoteOpenedWt);



  const setRemoteActiveWtBranch = useCallback((branch: string) => {
    useWorktreeStore.setState({ remoteActiveWtBranch: branch });
  }, []);

  const setRemoteOpenedWt: Dispatch<SetStateAction<WorktreeItem[]>> = useCallback((updater) => {
    useWorktreeStore.setState((state) => ({
      remoteOpenedWt: typeof updater === "function" ? updater(state.remoteOpenedWt) : updater,
    }));
  }, []);

  const openWorktreeTerminal = useCallback((worktreePath: string, branch: string) => {
    useWorktreeStore.setState({ activeWorktreePath: worktreePath });
    setRemoteActiveWtBranch(branch);
    setRemoteOpenedWt((prev) =>
      prev.some((item) => item.path === worktreePath)
        ? prev
        : [...prev, { path: worktreePath, branch }],
    );
  }, [setRemoteActiveWtBranch, setRemoteOpenedWt]);

  const resetRemoteTransientState = useCallback(() => {
    useWorktreeStore.setState({
      activeWorktreePath: null,
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
      return invokeRemoteGitCommand(command, entry.host, entry.port, entry.username, auth, extra);
    },
    [remoteEntries, remoteAuthStore],
  );

  const refreshRemoteGit = useMemo(() => {
    const handler = async (entryId: string, projectId: string, _projectPath: string): Promise<void> => {
      const entry = remoteEntries.find((item) => item.id === entryId);
      const auth = remoteAuthStore.get(entryId);
      if (!entry || !auth) {
        console.error("[SSH] No auth for entry");
        return;
      }
      const gitInfo = await getGitInfo(projectId).catch((e) => {
        console.error("[SSH] Failed to refresh git info:", e);
        return null;
      });
      if (!gitInfo) return;

      setRemoteEntries((prev) =>
        updateProjectInEntries(prev, projectId, (project) => ({
          ...project,
          git_info: gitInfo,
        }))
      );

      // Sync updated git_info to unified project store
      useProjectStore.setState((state) => {
        if (!state.activeProject || state.activeProject.id !== projectId) return state;
        return {
          activeProject: { ...state.activeProject, git_info: gitInfo },
          projects: state.projects.map((p) =>
            p.id === projectId ? { ...p, git_info: gitInfo } : p,
          ),
        };
      });
    };
    return handler;
  }, [remoteEntries, remoteAuthStore, setRemoteEntries]);



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

    openRemoteIde(entry.host, entry.port, entry.username, projectPath, ide).catch((error) => {
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
    const activeProject = useProjectStore.getState().activeProject;
    if (!activeProject || activeProject.environment.type !== 'Remote') return;

    const agentId = agent?.id ?? null;
    const nextEntries = updateProjectInEntries(
      remoteEntries,
      activeProject.id,
      (project) => ({ ...project, selected_agent: agentId }),
    );
    setRemoteEntries(nextEntries);
    useProjectStore.setState((state) => {
      if (state.activeProject?.id !== activeProject.id) return state;
      return { activeProject: { ...state.activeProject, selected_agent: agentId } };
    });
    saveSession(undefined, nextEntries).catch(console.error);
  }, [remoteEntries, saveSession, setRemoteEntries]);

  const handleSelectRemoteAgent = useCallback((agent: AgentConfig | null) => {
    const activeProject = useProjectStore.getState().activeProject;
    if (!activeProject || activeProject.environment.type !== 'Remote') return;
    const env = activeProject.environment;
    const entryId = remoteEntries.find(e => e.host === env.host)?.id ?? '';
    const cacheKey = remoteCacheKey(entryId, activeProject.id);
    if (agent) {
      void switchAgentInRemoteTerminal(cacheKey, agent.id, config.agentCommandOverrides);
    }
    updateRemoteProjectAgent(agent);
    if (!agent) {
      setTimeout(() => refreshRemoteTerminal(cacheKey), 50);
    }
  }, [config.agentCommandOverrides, remoteEntries, updateRemoteProjectAgent]);

  return {
    // @deprecated - use activeWorktreePath from worktreeStore instead
    activeRemoteWorktreePath: unifiedActiveWtPath,
    // @deprecated - use worktreeStore.setState({ activeWorktreePath }) instead
    setActiveRemoteWorktreePath: (path: string | null) => useWorktreeStore.setState({ activeWorktreePath: path }),
    remoteActiveWtBranch,
    setRemoteActiveWtBranch,
    remoteOpenedWt,
    setRemoteOpenedWt,
    resetRemoteTransientState,
    invokeRemoteGit,
    handleRefreshRemoteGit,
    handleOpenRemoteIde,
    handleOpenRemoteWorktreeTerminal,
    handleSelectRemoteAgent,
    updateRemoteProjectAgent,
  };
}

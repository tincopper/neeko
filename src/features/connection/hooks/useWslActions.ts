import { useCallback, useState, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { openWslIde } from "../../project/api/projectApi";
import { getGitInfo } from "../../git/api/gitApi";
import {
  refreshWslTerminal,
  switchAgentInWslTerminal,
  wslCacheKey,
} from "@/features/terminal/components/terminalCache";
import { useConnectionStore } from "../store";
import { useWorktreeStore } from '@/features/project/worktreeStore';
import { useProjectStore } from '@/features/project/store';
import { useEditorStore } from '@/shared/store';
import { useShallow } from "zustand/shallow";
import type {
  AgentConfig,
  AppConfig,
  Tab,
  WSLEntrySession,
} from '@/shared/types';
import { updateProjectInEntries } from '@/shared/utils/entryUpdates';
import type { SaveSessionFn } from "./useWslProjects";
import type { WorktreeItem } from "@/features/project/hooks/useWorktreeState";

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
  const wslEntries = useConnectionStore(useShallow((state) => state.wslEntries));

  const setWslEntries: Dispatch<SetStateAction<WSLEntrySession[]>> = useCallback((updater) => {
    useConnectionStore.setState((state) => ({
      wslEntries: typeof updater === "function" ? updater(state.wslEntries) : updater,
    }));
  }, []);

  // ── WSL transient worktree state ──
  // Uses unified activeWorktreePath for path; WSL-specific branch/opened
  // remain separate until WSL fully migrates to worktreeStateMap.
  const unifiedActiveWtPath = useWorktreeStore((s) => s.activeWorktreePath);
  const wslActiveWtBranch = useWorktreeStore((s) => s.wslActiveWtBranch);
  const wslOpenedWt = useWorktreeStore((s) => s.wslOpenedWt);

  // diffState stays local (typed per-connection and only consumed via context)
  const [wslDiffState, setWslDiffState] = useState<WslDiffState | null>(null);

  const setWslActiveWtBranch = useCallback((branch: string) => {
    useWorktreeStore.setState({ wslActiveWtBranch: branch });
  }, []);

  const setWslOpenedWt: Dispatch<SetStateAction<WorktreeItem[]>> = useCallback((updater) => {
    useWorktreeStore.setState((state) => ({
      wslOpenedWt: typeof updater === "function" ? updater(state.wslOpenedWt) : updater,
    }));
  }, []);

  const openWorktreeTerminal = useCallback((worktreePath: string, branch: string) => {
    useWorktreeStore.setState({ activeWorktreePath: worktreePath });
    setWslActiveWtBranch(branch);
    setWslOpenedWt((prev) =>
      prev.some((item) => item.path === worktreePath)
        ? prev
        : [...prev, { path: worktreePath, branch }],
    );
    setWslDiffState(null);
  }, [setWslActiveWtBranch, setWslOpenedWt]);

  const resetWslTransientState = useCallback(() => {
    useWorktreeStore.setState({
      activeWorktreePath: null,
      wslActiveWtBranch: "",
      wslOpenedWt: [],
    });
    setWslDiffState(null);
  }, []);

  const refreshWslGit = useMemo(() => {
    const handler = async (_distro: string, projectId: string, _projectPath: string): Promise<void> => {
      const gitInfo = await getGitInfo(projectId).catch((e) => {
        console.error("[WSL] Failed to refresh git info:", e);
        return null;
      });
      if (!gitInfo) return;

      setWslEntries((prev) =>
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
  }, [setWslEntries]);

  const handleSelectWslFile = useCallback((distro: string, projectPath: string, filePath: string) => {
    const activeProject = useProjectStore.getState().activeProject;
    if (!activeProject) return;

    const projectId = activeProject.id;
    const existingTabs = useEditorStore.getState().tabs[projectId];
    const existingDiffTab = existingTabs?.tabs.find(
      (t) => t.data.kind === "diff" && t.data.filePath === filePath
    );
    if (existingDiffTab) {
      useEditorStore.getState().activateTab(projectId, existingDiffTab.id);
      return;
    }

    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    const tabId = `tab_${crypto.randomUUID()}`;
    const tab: Tab = {
      id: tabId,
      projectId,
      title: fileName,
      order: existingTabs?.tabs.length ?? 0,
      data: {
        kind: "diff",
        filePath,
        fileName,
        diffSource: { type: "wsl", distro, projectPath },
      },
    };
    useEditorStore.getState().addTab(projectId, tab);
    useEditorStore.getState().activateTab(projectId, tabId);
  }, []);

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
    openWslIde(distro, projectPath, ide).catch((error) => {
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

  const updateWslProjectAgent = useCallback((agent: AgentConfig | null) => {
    const activeProject = useProjectStore.getState().activeProject;
    if (!activeProject) return;

    const agentId = agent?.id ?? null;
    const nextEntries = updateProjectInEntries(
      wslEntries,
      activeProject.id,
      (project) => ({ ...project, selected_agent: agentId }),
    );
    setWslEntries(nextEntries);
    useProjectStore.setState((state) => {
      if (state.activeProject?.id !== activeProject.id) return state;
      return { activeProject: { ...state.activeProject, selected_agent: agentId } };
    });
    saveSession(nextEntries, undefined).catch(console.error);
  }, [saveSession, setWslEntries, wslEntries]);

  const handleSelectWslAgent = useCallback((agent: AgentConfig | null) => {
    const activeProject = useProjectStore.getState().activeProject;
    if (!activeProject || activeProject.environment.type !== 'Wsl') return;

    const distro = activeProject.environment.distro;
    const cacheKey = wslCacheKey(distro, activeProject.id);
    if (agent) {
      void switchAgentInWslTerminal(
        cacheKey,
        distro,
        activeProject.path,
        activeProject.name,
        agent.id,
        config.terminalFontSize ?? 14,
        config.fontFamily ?? "",
        config.agentCommandOverrides,
      );
    }

    updateWslProjectAgent(agent);

    if (!agent) {
      setTimeout(() => refreshWslTerminal(cacheKey), 50);
    }
  }, [config, updateWslProjectAgent]);

  return {
    wslDiffState,
    setWslDiffState,
    // @deprecated - use activeWorktreePath from worktreeStore instead
    activeWslWorktreePath: unifiedActiveWtPath,
    // @deprecated - use worktreeStore.setState({ activeWorktreePath }) instead
    setActiveWslWorktreePath: (path: string | null) => useWorktreeStore.setState({ activeWorktreePath: path }),
    wslActiveWtBranch,
    setWslActiveWtBranch,
    wslOpenedWt,
    setWslOpenedWt,
    resetWslTransientState,
    handleSelectWslFile,
    handleRefreshWslGit,
    handleOpenWslIde,
    handleOpenWslWorktreeTerminal,
    handleSelectWslAgent,
    updateWslProjectAgent,
  };
}

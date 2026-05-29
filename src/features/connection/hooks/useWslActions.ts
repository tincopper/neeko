import { useCallback, useState, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  refreshWslTerminal,
  switchAgentInWslTerminal,
  wslCacheKey,
} from "@/features/terminal/components/terminalCache";
import { useConnectionStore } from "../store";
import { useWorktreeStore } from '@/features/project/worktreeStore';
import { useProjectStore } from '@/features/project/store';
import { useEditorStore } from '@/features/editor/store';
import { useShallow } from "zustand/shallow";
import type {
  AgentConfig,
  AppConfig,
  GitInfo,
  Tab,
  WSLProject,
  WSLEntrySession,
} from "../../../types";
import { buildRefreshGitHandler, updateProjectInEntries } from '@/shared/utils/entryUpdates';
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
  const activeWslProject = useConnectionStore((state) => state.activeWslProject);

  const setWslEntries: Dispatch<SetStateAction<WSLEntrySession[]>> = useCallback((updater) => {
    useConnectionStore.setState((state) => ({
      wslEntries: typeof updater === "function" ? updater(state.wslEntries) : updater,
    }));
  }, []);

  const setActiveWslProject: Dispatch<SetStateAction<{ distro: string; project: WSLProject } | null>> = useCallback((updater) => {
    useConnectionStore.setState((state) => ({
      activeWslProject: typeof updater === "function" ? updater(state.activeWslProject) : updater,
    }));
  }, []);

  // ── WSL transient worktree state ──
  // activeWorktreePath / activeWorktreeBranch / openedWorktrees live in appStore
  // to avoid useState �?useSyncToStore double-render and enable merged setState.
  const activeWslWorktreePath = useWorktreeStore((s) => s.activeWslWorktreePath);
  const wslActiveWtBranch = useWorktreeStore((s) => s.wslActiveWtBranch);
  const wslOpenedWt = useWorktreeStore((s) => s.wslOpenedWt);

  // diffState stays local (typed per-connection and only consumed via context)
  const [wslDiffState, setWslDiffState] = useState<WslDiffState | null>(null);

  const setActiveWslWorktreePath = useCallback((path: string | null) => {
    useWorktreeStore.setState({ activeWslWorktreePath: path });
  }, []);

  const setWslActiveWtBranch = useCallback((branch: string) => {
    useWorktreeStore.setState({ wslActiveWtBranch: branch });
  }, []);

  const setWslOpenedWt: Dispatch<SetStateAction<WorktreeItem[]>> = useCallback((updater) => {
    useWorktreeStore.setState((state) => ({
      wslOpenedWt: typeof updater === "function" ? updater(state.wslOpenedWt) : updater,
    }));
  }, []);

  const openWorktreeTerminal = useCallback((worktreePath: string, branch: string) => {
    setActiveWslWorktreePath(worktreePath);
    setWslActiveWtBranch(branch);
    setWslOpenedWt((prev) =>
      prev.some((item) => item.path === worktreePath)
        ? prev
        : [...prev, { path: worktreePath, branch }],
    );
    setWslDiffState(null);
  }, [setActiveWslWorktreePath, setWslActiveWtBranch, setWslOpenedWt]);

  const resetWslTransientState = useCallback(() => {
    useWorktreeStore.setState({
      activeWslWorktreePath: null,
      wslActiveWtBranch: "",
      wslOpenedWt: [],
    });
    setWslDiffState(null);
  }, []);

  const refreshWslGit = useMemo(() => buildRefreshGitHandler<
    WSLProject,
    WSLEntrySession,
    { distro: string; project: WSLProject },
    string
  >({
    refreshGitInfo: async (projectPath, distro) => (
      invoke<GitInfo>("get_git_info", {
        transport: { Wsl: { distro, project_path: projectPath } },
      }).catch((e) => {
        console.error("[WSL] Failed to refresh git info:", e);
        return null;
      })
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
    useProjectStore.setState({
      activeProjectId: null,
      activeProject: null,
    });
    useConnectionStore.setState({
      activeWslKey: { distro, projectId: project.id },
      activeWslProject: { distro, project },
      activeRemoteKey: null,
      activeRemoteProject: null,
    });
    resetWslTransientState();
    void refreshWslGit(distro, project.id, project.path);
  }, [resetWslTransientState, refreshWslGit]);

  const handleSelectWslFile = useCallback((distro: string, projectPath: string, filePath: string) => {
    if (!activeWslProject) return;

    const projectId = activeWslProject.project.id;
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
  }, [activeWslProject]);

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

  const updateWslProjectAgent = useCallback((agent: AgentConfig | null) => {
    if (!activeWslProject) return;

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
    saveSession(nextEntries, undefined).catch(console.error);
  }, [activeWslProject, saveSession, setActiveWslProject, setWslEntries, wslEntries]);

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

    updateWslProjectAgent(agent);

    if (!agent) {
      setTimeout(() => refreshWslTerminal(cacheKey), 50);
    }
  }, [activeWslProject, config, updateWslProjectAgent]);

  return {
    wslDiffState,
    setWslDiffState,
    activeWslWorktreePath,
    setActiveWslWorktreePath,
    wslActiveWtBranch,
    setWslActiveWtBranch,
    wslOpenedWt,
    setWslOpenedWt,
    resetWslTransientState,
    handleSelectWslProject,
    handleSelectWslFile,
    handleRefreshWslGit,
    handleOpenWslIde,
    handleOpenWslWorktreeTerminal,
    handleSelectWslAgent,
    updateWslProjectAgent,
  };
}

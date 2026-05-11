import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/appStore";
import type { Tab } from "../types";
import type { WorktreeItem } from "./useWorktreeState";

interface UseWorktreeActionsParams {
  setActiveWorktreePath: (path: string | null) => void;
  setActiveWorktreeBranch: (branch: string) => void;
  setOpenedWorktrees: Dispatch<SetStateAction<WorktreeItem[]>>;
  saveWorktreeState: (projectId: string, wtPath: string | null) => void;
}

interface UseWorktreeActionsResult {
  handleBackToMainTerminal: (projectId: string) => void;
  handleOpenWorktreeTerminal: (
    projectId: string,
    worktreePath: string,
    branch: string,
  ) => Promise<void>;
  handleSelectWorktreeFile: (worktreePath: string, filePath: string) => void;
}

export function useWorktreeActions({
  setActiveWorktreePath,
  setActiveWorktreeBranch,
  setOpenedWorktrees,
  saveWorktreeState,
}: UseWorktreeActionsParams): UseWorktreeActionsResult {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const activeWorktreePath = useAppStore((state) => state.activeWorktreePath);

  const handleBackToMainTerminal = useCallback((projectId: string) => {
    if (activeWorktreePath !== null) {
      setActiveWorktreePath(null);
      setActiveWorktreeBranch("");
    }
    invoke("set_view_terminal", { projectId }).catch(() => { });
  }, [activeWorktreePath, setActiveWorktreePath, setActiveWorktreeBranch]);

  const handleOpenWorktreeTerminal = useCallback(async (
    projectId: string,
    worktreePath: string,
    branch: string,
  ) => {
    if (activeProjectId !== projectId) {
      useAppStore.setState((state) => {
        const targetProjectTabs = state.tabs[projectId];
        return {
          activeProjectId: projectId,
          activeProject: state.projects.find((project) => project.id === projectId) ?? null,
          activeTabId: targetProjectTabs?.activeTabId ?? null,
        };
      });
      await invoke("set_active_project", { projectId });
    }

    setActiveWorktreePath(worktreePath);
    setActiveWorktreeBranch(branch);
    setOpenedWorktrees((prev) => {
      if (prev.some((item) => item.path === worktreePath)) {
        return prev;
      }
      return [...prev, { path: worktreePath, branch }];
    });
    saveWorktreeState(projectId, worktreePath);
    invoke("set_view_terminal", { projectId }).catch(() => { });

    // Create a new terminal tab for the worktree
    const existingTabs = useAppStore.getState().tabs[projectId];
    const terminalCount = (existingTabs?.tabs.filter((t) => t.data.kind === "terminal").length ?? 0);
    const tabId = `tab_${crypto.randomUUID()}`;
    const terminalTab: Tab = {
      id: tabId,
      projectId,
      title: `Terminal ${terminalCount + 1}`,
      order: existingTabs?.tabs.length ?? 0,
      data: { kind: "terminal", agentId: null, status: "Idle" as const },
    };
    useAppStore.getState().addTab(projectId, terminalTab);
    useAppStore.getState().activateTab(projectId, tabId);
  }, [
    activeProjectId,
    setActiveWorktreePath,
    setActiveWorktreeBranch,
    setOpenedWorktrees,
    saveWorktreeState,
  ]);

  const handleSelectWorktreeFile = useCallback((worktreePath: string, filePath: string) => {
    if (!activeProjectId) return;

    const existingTabs = useAppStore.getState().tabs[activeProjectId];
    const existingDiffTab = existingTabs?.tabs.find(
      (t) => t.data.kind === "diff" && t.data.filePath === filePath
    );
    if (existingDiffTab) {
      useAppStore.getState().activateTab(activeProjectId, existingDiffTab.id);
      return;
    }

    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    const tabId = `tab_${crypto.randomUUID()}`;
    const tab: Tab = {
      id: tabId,
      projectId: activeProjectId,
      title: fileName,
      order: existingTabs?.tabs.length ?? 0,
      data: {
        kind: "diff",
        filePath,
        fileName,
        diffSource: { type: "worktree", projectId: activeProjectId, worktreePath },
      },
    };
    useAppStore.getState().addTab(activeProjectId, tab);
    useAppStore.getState().activateTab(activeProjectId, tabId);
  }, [activeProjectId]);

  return {
    handleBackToMainTerminal,
    handleOpenWorktreeTerminal,
    handleSelectWorktreeFile,
  };
}

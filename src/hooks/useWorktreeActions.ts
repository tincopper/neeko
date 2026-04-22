import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/appStore";
import type { WorktreeItem } from "./useWorktreeState";

interface UseWorktreeActionsParams {
  setActiveWorktreePath: (path: string | null) => void;
  setActiveWorktreeBranch: (branch: string) => void;
  setOpenedWorktrees: Dispatch<SetStateAction<WorktreeItem[]>>;
  setWorktreeDiffState: (state: { worktreePath: string; filePath: string } | null) => void;
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
  handleWorktreeDiffBack: () => void;
}

export function useWorktreeActions({
  setActiveWorktreePath,
  setActiveWorktreeBranch,
  setOpenedWorktrees,
  setWorktreeDiffState,
  saveWorktreeState,
}: UseWorktreeActionsParams): UseWorktreeActionsResult {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const activeWorktreePath = useAppStore((state) => state.activeWorktreePath);

  const handleBackToMainTerminal = useCallback((projectId: string) => {
    if (activeWorktreePath !== null) {
      setActiveWorktreePath(null);
      setActiveWorktreeBranch("");
    }
    setWorktreeDiffState(null);
    invoke("set_view_terminal", { projectId }).catch(() => { });
  }, [activeWorktreePath, setActiveWorktreePath, setActiveWorktreeBranch, setWorktreeDiffState]);

  const handleOpenWorktreeTerminal = useCallback(async (
    projectId: string,
    worktreePath: string,
    branch: string,
  ) => {
    if (activeProjectId !== projectId) {
      useAppStore.setState((state) => ({
        activeProjectId: projectId,
        activeProject: state.projects.find((project) => project.id === projectId) ?? null,
      }));
      await invoke("set_active_project", { projectId });
    }

    setWorktreeDiffState(null);
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
  }, [
    activeProjectId,
    setWorktreeDiffState,
    setActiveWorktreePath,
    setActiveWorktreeBranch,
    setOpenedWorktrees,
    saveWorktreeState,
  ]);

  const handleSelectWorktreeFile = useCallback((worktreePath: string, filePath: string) => {
    setWorktreeDiffState({ worktreePath, filePath });
  }, [setWorktreeDiffState]);

  const handleWorktreeDiffBack = useCallback(() => {
    setWorktreeDiffState(null);
  }, [setWorktreeDiffState]);

  return {
    handleBackToMainTerminal,
    handleOpenWorktreeTerminal,
    handleSelectWorktreeFile,
    handleWorktreeDiffBack,
  };
}

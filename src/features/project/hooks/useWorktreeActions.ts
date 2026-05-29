import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from '@/features/project/store';
import { useWorktreeStore } from '@/features/project/worktreeStore';
import { useEditorStore } from '@/features/editor/store';
import type { Tab } from "../../../types";
import type { WorktreeItem } from "./useWorktreeState";
import { buildWorktreeTabKey } from '@/shared/utils/tabKey';

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
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeWorktreePath = useWorktreeStore((state) => state.activeWorktreePath);

  const handleBackToMainTerminal = useCallback((projectId: string) => {
    if (activeWorktreePath !== null) {
      setActiveWorktreePath(null);
      setActiveWorktreeBranch("");
      saveWorktreeState(projectId, null);
    }
    invoke("set_view_terminal", { projectId }).catch(() => { });
  }, [activeWorktreePath, setActiveWorktreePath, setActiveWorktreeBranch, saveWorktreeState]);

  const handleOpenWorktreeTerminal = useCallback(async (
    projectId: string,
    worktreePath: string,
    branch: string,
  ) => {
    if (activeProjectId !== projectId) {
      const targetProjectTabs = useEditorStore.getState().tabs[projectId];
      useProjectStore.setState({
        activeProjectId: projectId,
        activeProject: useProjectStore.getState().projects.find((project) => project.id === projectId) ?? null,
      });
      useEditorStore.setState({
        activeTabId: targetProjectTabs?.activeTabId ?? null,
      });
      invoke("set_active_project", { projectId }).catch(console.error);
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
  }, [
    activeProjectId,
    setActiveWorktreePath,
    setActiveWorktreeBranch,
    setOpenedWorktrees,
    saveWorktreeState,
  ]);

  const handleSelectWorktreeFile = useCallback((worktreePath: string, filePath: string) => {
    if (!activeProjectId) return;

    const tabKey = buildWorktreeTabKey(activeProjectId, worktreePath);
    const existingTabs = useEditorStore.getState().tabs[tabKey];
    const existingDiffTab = existingTabs?.tabs.find(
      (t) => t.data.kind === "diff" && t.data.filePath === filePath
    );
    if (existingDiffTab) {
      useEditorStore.getState().activateTab(tabKey, existingDiffTab.id);
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
    useEditorStore.getState().addTab(tabKey, tab);
    useEditorStore.getState().activateTab(tabKey, tabId);
  }, [activeProjectId]);

  return {
    handleBackToMainTerminal,
    handleOpenWorktreeTerminal,
    handleSelectWorktreeFile,
  };
}

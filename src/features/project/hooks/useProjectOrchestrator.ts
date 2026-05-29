import { useEffect } from "react";
import { useWorktreeState } from "@/features/project/hooks/useWorktreeState";
import { useWorktreeActions } from "@/features/project/hooks/useWorktreeActions";
import { useProjectSelection } from "@/features/project/hooks/useProjectSelection";
import { useCrossTypeSelection } from "@/features/project/hooks/useCrossTypeSelection";
import { useProjectStore } from "@/features/project/store";
import { useConnectionStore } from "@/features/connection/store";
import type { WSLProject, RemoteProject } from "@/types/connection";

interface WslActionShape {
  setWslDiffState: (state: null) => void;
  resetWslTransientState: () => void;
  handleSelectWslProject: (distro: string, project: WSLProject) => void;
  handleOpenWslWorktreeTerminal: (distro: string, worktreePath: string, branch: string) => void;
  setActiveWslWorktreePath: (path: string | null) => void;
  setWslActiveWtBranch: (branch: string) => void;
}

interface RemoteActionShape {
  resetRemoteTransientState: () => void;
  handleSelectRemoteProject: (host: string, project: RemoteProject) => void;
  handleOpenRemoteWorktreeTerminal: (entryId: string, worktreePath: string, branch: string) => void;
  setActiveRemoteWorktreePath: (path: string | null) => void;
  setRemoteActiveWtBranch: (branch: string) => void;
}

interface UseProjectOrchestratorParams {
  activeProjectId: string | null;
  activeProject: {
    id: string; path: string; active_view: string | { Diff: { file_path: string } };
    git_info: { worktrees: Array<{ path: string }> } | null;
  } | null;
  handleDragEnd: (result: { source: { index: number }; destination: { index: number } } | null) => void;
  handleRefreshGit: (projectId: string) => void;
  handleSelectFile: (filePath: string) => void;
  handleAddProject: () => void;
  handleRemoveProject: (projectId: string) => void;
  saveWorktreeState: (projectId: string, wtPath: string | null) => void;
  wslActions: WslActionShape;
  remoteActions: RemoteActionShape;
  agentActions: {
    handleOpenIdeCallback: (project: { id: string; selected_ide: string | null }) => void;
    handleSetProjectIde: (projectId: string, ideCommand: string | null) => void;
    handleOpenIdeForSidebar: (projectId: string) => void;
    handleSaveProjectSettings: (projectId: string, settings: Record<string, unknown>) => void;
  };
}

export function useProjectOrchestrator(params: UseProjectOrchestratorParams) {
  const { activeProjectId, activeProject, handleDragEnd, handleRefreshGit, handleSelectFile, handleAddProject, handleRemoveProject, saveWorktreeState, wslActions, remoteActions, agentActions } = params;

  const { activeWorktreePath, activeWorktreeBranch, updateWtPath, setActiveWorktreePath, setActiveWorktreeBranch, setOpenedWorktrees } = useWorktreeState(activeProjectId);

  useEffect(() => {
    if (!activeWorktreePath || !activeProject?.git_info) return;
    if (!activeProject.git_info.worktrees.some((wt) => wt.path === activeWorktreePath)) {
      setActiveWorktreePath(null);
      setActiveWorktreeBranch("");
    }
  }, [activeProject?.git_info?.worktrees, activeWorktreePath, setActiveWorktreePath, setActiveWorktreeBranch]);

  const worktreeActions = useWorktreeActions({ setActiveWorktreePath, setActiveWorktreeBranch, setOpenedWorktrees, saveWorktreeState });
  const { selectProject } = useProjectSelection();

  const cross = useCrossTypeSelection({ wslActions, remoteActions, selectProject });

  const isTerminalView = activeProject?.active_view === "Terminal";

  useEffect(() => {
    useProjectStore.setState({ isTerminalView: isTerminalView || activeWorktreePath !== null, selectProject: cross.handleSelectProject, openIde: agentActions.handleOpenIdeCallback, setProjectIde: agentActions.handleSetProjectIde });
  }, [isTerminalView, activeWorktreePath, cross.handleSelectProject, agentActions.handleOpenIdeCallback, agentActions.handleSetProjectIde]);

  useEffect(() => {
    useConnectionStore.setState({ selectWslProject: cross.handleSelectWslProject, selectRemoteProject: cross.handleSelectRemoteProject });
  }, [cross.handleSelectWslProject, cross.handleSelectRemoteProject]);

  const projectActionsValue = {
    onRemoveProject: handleRemoveProject, onSelectProject: cross.handleSelectProject, onAddProject: handleAddProject,
    onSelectFile: handleSelectFile, onRefreshGit: handleRefreshGit, onBackToMainTerminal: worktreeActions.handleBackToMainTerminal,
    onOpenIde: agentActions.handleOpenIdeForSidebar, onOpenWorktreeTerminal: worktreeActions.handleOpenWorktreeTerminal,
    onSelectWorktreeFile: worktreeActions.handleSelectWorktreeFile, onDragEnd: handleDragEnd, onSaveProjectSettings: agentActions.handleSaveProjectSettings,
  };

  return { activeWorktreePath, activeWorktreeBranch, updateWtPath, projectActionsValue, ...cross };
}


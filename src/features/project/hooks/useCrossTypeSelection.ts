import { useCallback } from "react";
import type { WSLProject, RemoteProject } from '@/shared/types';
import { useAppViewStore } from '@/shared/store/appViewStore';

interface WslActions {
  setWslDiffState: (state: null) => void;
  resetWslTransientState: () => void;
  handleSelectWslProject: (distro: string, project: WSLProject) => void;
  handleOpenWslWorktreeTerminal: (distro: string, worktreePath: string, branch: string) => void;
  setActiveWslWorktreePath: (path: string | null) => void;
  setWslActiveWtBranch: (branch: string) => void;
}

interface RemoteActions {
  resetRemoteTransientState: () => void;
  handleSelectRemoteProject: (host: string, project: RemoteProject) => void;
  handleOpenRemoteWorktreeTerminal: (
    entryId: string,
    worktreePath: string,
    branch: string,
  ) => void;
  setActiveRemoteWorktreePath: (path: string | null) => void;
  setRemoteActiveWtBranch: (branch: string) => void;
}

interface UseCrossTypeSelectionOptions {
  wslActions: WslActions;
  remoteActions: RemoteActions;
  selectProject: (projectId: string) => Promise<void>;
}

export function useCrossTypeSelection({
  wslActions,
  remoteActions,
  selectProject,
}: UseCrossTypeSelectionOptions) {
  const closeSettingsView = useCallback(() => {
    if (useAppViewStore.getState().appView === "settings") {
      useAppViewStore.getState().setAppView("normal");
    }
  }, []);

  // Local project selection: clear WSL diff state
  const handleSelectProject = useCallback(
    async (projectId: string) => {
      closeSettingsView();
      wslActions.setWslDiffState(null);
      await selectProject(projectId);
    },
    [closeSettingsView, wslActions, selectProject],
  );

  // WSL project selection: clear Remote transient state
  const handleSelectWslProject = useCallback(
    (distro: string, project: WSLProject) => {
      closeSettingsView();
      remoteActions.resetRemoteTransientState();
      wslActions.handleSelectWslProject(distro, project);
    },
    [closeSettingsView, remoteActions, wslActions],
  );

  // WSL worktree terminal: clear Remote transient state
  const handleOpenWslWorktreeTerminal = useCallback(
    (distro: string, worktreePath: string, branch: string) => {
      remoteActions.resetRemoteTransientState();
      wslActions.handleOpenWslWorktreeTerminal(distro, worktreePath, branch);
    },
    [remoteActions, wslActions],
  );

  // Remote project selection: clear WSL transient state
  const handleSelectRemoteProject = useCallback(
    (host: string, project: RemoteProject) => {
      closeSettingsView();
      wslActions.resetWslTransientState();
      remoteActions.handleSelectRemoteProject(host, project);
    },
    [closeSettingsView, wslActions, remoteActions],
  );

  // Remote worktree terminal: clear WSL transient state
  const handleOpenRemoteWorktreeTerminal = useCallback(
    (entryId: string, worktreePath: string, branch: string) => {
      wslActions.resetWslTransientState();
      remoteActions.handleOpenRemoteWorktreeTerminal(entryId, worktreePath, branch);
    },
    [wslActions, remoteActions],
  );

  return {
    handleSelectProject,
    handleSelectWslProject,
    handleSelectRemoteProject,
    handleOpenWslWorktreeTerminal,
    handleOpenRemoteWorktreeTerminal,
  };
}

import { useCallback } from "react";
import { useProjectStore } from "@/features/project/store";
import { useConnectionStore } from "@/features/connection/store";
import { useWorktreeStore } from "@/features/project/worktreeStore";
import { useAppViewStore } from '@/shared/store/appViewStore';

interface WslActions {
  setWslDiffState: ((state: null) => void) | undefined;
  resetTransientState: () => void;
  handleRefreshGit: (distro: string, projectId: string, projectPath: string) => void;
  handleOpenWorktreeTerminal: (distro: string, worktreePath: string, branch: string) => void;
  setActiveWorktreePath: (path: string | null) => void;
}

interface RemoteActions {
  resetTransientState: () => void;
  handleRefreshGit: (entryId: string, projectId: string, projectPath: string) => void;
  handleOpenWorktreeTerminal: (
    entryId: string,
    worktreePath: string,
    branch: string,
  ) => void;
  setActiveWorktreePath: (path: string | null) => void;
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

  const handleSelectProject = useCallback(
    async (projectId: string) => {
      closeSettingsView();

      // Reset all transient worktree state
      useWorktreeStore.setState({
        activeWorktreePath: null,
        activeWorktreeBranch: "",
      });
      wslActions.setWslDiffState?.(null);
      remoteActions.resetTransientState();

      // Find project in unified store
      const project = useProjectStore.getState().projects.find(p => p.id === projectId);
      if (!project) return;

      // Always set unified active project (environment type is transparent)
      useProjectStore.setState({
        activeProjectId: project.id,
        activeProject: project,
      });

      if (project.environment.type === 'Wsl') {
        void wslActions.handleRefreshGit(project.environment.distro, project.id, project.path);
      } else if (project.environment.type === 'Remote') {
        const host = project.environment.host;
        const entry = useConnectionStore.getState().remoteEntries.find(e => e.host === host) ?? null;
        if (entry) {
          void remoteActions.handleRefreshGit(entry.id, project.id, project.path);
        }
      } else {
        await selectProject(projectId);
      }
    },
    [closeSettingsView, selectProject, wslActions, remoteActions],
  );

  const handleOpenWslWorktreeTerminal = useCallback(
    (distro: string, worktreePath: string, branch: string) => {
      remoteActions.resetTransientState();
      wslActions.handleOpenWorktreeTerminal(distro, worktreePath, branch);
    },
    [remoteActions, wslActions],
  );

  const handleOpenRemoteWorktreeTerminal = useCallback(
    (entryId: string, worktreePath: string, branch: string) => {
      wslActions.resetTransientState();
      remoteActions.handleOpenWorktreeTerminal(entryId, worktreePath, branch);
    },
    [wslActions, remoteActions],
  );

  return {
    handleSelectProject,
    handleOpenWslWorktreeTerminal,
    handleOpenRemoteWorktreeTerminal,
  };
}

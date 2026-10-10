import { useCallback } from 'react';

import { useAppViewStore } from '@/shared/store/appViewStore';
import { useConnectionStore } from '@/shared/store/connectionStore';
import { restoreActiveTabId } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { activeWorkspaceSession, useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';

interface WslActions {
  setWslDiffState: ((state: null) => void) | undefined;
  resetTransientState: () => void;
  handleRefreshGit: (distro: string, projectId: ProjectId, projectPath: string) => void;
  handleOpenWorktreeTerminal: (distro: string, worktreePath: string, branch: string) => void;
  setActiveWorkspacePath: (path: string | null) => void;
}

interface RemoteActions {
  resetTransientState: () => void;
  handleRefreshGit: (entryId: string, projectId: ProjectId, projectPath: string) => void;
  handleOpenWorktreeTerminal: (entryId: string, worktreePath: string, branch: string) => void;
  setActiveWorkspacePath: (path: string | null) => void;
}

interface UseCrossTypeSelectionOptions {
  wslActions: WslActions;
  remoteActions: RemoteActions;
  selectProject: (projectId: ProjectId) => Promise<void>;
}

export function useCrossTypeSelection({
  wslActions,
  remoteActions,
  selectProject,
}: UseCrossTypeSelectionOptions) {
  const closeSettingsView = useCallback(() => {
    if (useAppViewStore.getState().appView === 'settings') {
      useAppViewStore.getState().setAppView('normal');
    }
  }, []);

  const handleSelectProject = useCallback(
    async (projectId: ProjectId) => {
      closeSettingsView();

      // 切换项目类型：清掉各项目的激活单元（后端挂载由 useActiveWorkspaceSync 跟随）
      for (const pid of Object.keys(useWorkspaceStore.getState().byProject)) {
        useWorkspaceStore.getState().clearActiveWorkspace(pid as ProjectId);
      }
      wslActions.setWslDiffState?.(null);
      remoteActions.resetTransientState();

      // Find project in unified store
      const project = useProjectStore.getState().projects.find((p) => p.id === projectId);
      if (!project) return;

      // Always set unified active project (environment type is transparent)
      useProjectStore.setState({
        activeProjectId: project.id,
        activeProject: project,
      });

      if (project.environment.type === 'Wsl') {
        // 切项目后全局 activeTabId 重派生于该项目当前单元的激活 tab
        // （此前只有 local 分支经 selectProject 同步，WSL/Remote 停留在上一项目 → 下游 cacheKey 陈旧）
        restoreActiveTabId(activeWorkspaceSession(project.id).key);
        void wslActions.handleRefreshGit(project.environment.distro, project.id, project.path);
      } else if (project.environment.type === 'Remote') {
        restoreActiveTabId(activeWorkspaceSession(project.id).key);
        const host = project.environment.host;
        const entry =
          useConnectionStore.getState().remoteEntries.find((e) => e.host === host) ?? null;
        if (entry) {
          void remoteActions.handleRefreshGit(entry.id, project.id, project.path);
        }
      } else {
        // local：selectProject 内部先清回主仓单元再同步 activeTabId
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

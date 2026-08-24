import { useEffect, useRef } from 'react';

interface GitProjectRef {
  id: string;
  git_info?: unknown;
}
interface WslEntryLike {
  distro: string;
  projects: GitProjectRef[];
}
interface RemoteEntryLike {
  id: string;
  projects: GitProjectRef[];
}

interface UseAppInitialGitRefreshParams {
  initializing: boolean;
  wslEntries: WslEntryLike[];
  remoteEntries: RemoteEntryLike[];
  remoteAuthStore: { has: (id: string) => boolean };
  wslActionsWrap: { handleRefreshGit: (distro: string, projectId: string) => void };
  remoteActionsWrap: { handleRefreshGit: (entryId: string, projectId: string) => void };
}

/**
 * 启动完成后，为缺失 git_info 的 WSL/远程项目补一轮 git 刷新（仅一次）。
 * 从 useAppShell 抽出：ref 守卫保证整个生命周期只执行一轮。
 */
export function useAppInitialGitRefresh({
  initializing,
  wslEntries,
  remoteEntries,
  remoteAuthStore,
  wslActionsWrap,
  remoteActionsWrap,
}: UseAppInitialGitRefreshParams): void {
  const doneRef = useRef(false);
  useEffect(() => {
    if (initializing || doneRef.current) return;
    doneRef.current = true;
    for (const entry of wslEntries) {
      for (const project of entry.projects) {
        // 仅对缺少 git_info（undefined）的项目补刷新；
        // null 表示非 git 项目、已有值表示已刷新，均跳过。
        if (project.git_info !== undefined) continue;
        void wslActionsWrap.handleRefreshGit(entry.distro, project.id);
      }
    }
    for (const entry of remoteEntries) {
      if (!remoteAuthStore.has(entry.id)) continue;
      for (const project of entry.projects) {
        if (project.git_info !== undefined) continue;
        void remoteActionsWrap.handleRefreshGit(entry.id, project.id);
      }
    }
  }, [initializing, wslEntries, remoteEntries, remoteAuthStore, wslActionsWrap, remoteActionsWrap]);
}

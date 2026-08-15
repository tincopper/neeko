import { useCallback } from 'react';

import type { AuthMethod, RemoteEntrySession, WSLEntrySession } from '@/shared/types';

interface WslEntryAddHandler {
  (entry: WSLEntrySession): Promise<void>;
}
interface RemoteEntryAddHandler {
  (entry: RemoteEntrySession, auth: AuthMethod | null, saved_auth?: string | null): Promise<void>;
}

interface UseAppEntryAddRefreshParams {
  handleWSLEntryAdd: WslEntryAddHandler;
  wslActionsWrap: { handleRefreshGit: (distro: string, projectId: string) => void };
  handleRemoteEntryAdd: RemoteEntryAddHandler;
  remoteAuthStore: { has: (id: string) => boolean };
  remoteActionsWrap: { handleRefreshGit: (entryId: string, projectId: string) => void };
}

/**
 * 新增 WSL/远程连接后：入库 + 对缺失 git_info 的项目补一轮 git 刷新。
 * 从 useAppShell 抽出，封装「连接添加 → 关联项目 git 信息拉取」的编排。
 */
export function useAppEntryAddRefresh({
  handleWSLEntryAdd,
  wslActionsWrap,
  handleRemoteEntryAdd,
  remoteAuthStore,
  remoteActionsWrap,
}: UseAppEntryAddRefreshParams): {
  handleWslEntryAddRefresh: WslEntryAddHandler;
  handleRemoteEntryAddRefresh: RemoteEntryAddHandler;
} {
  const handleWslEntryAddRefresh = useCallback(
    async (entry: WSLEntrySession) => {
      await handleWSLEntryAdd(entry);
      for (const project of entry.projects) {
        if (!project.git_info) void wslActionsWrap.handleRefreshGit(entry.distro, project.id);
      }
    },
    [handleWSLEntryAdd, wslActionsWrap],
  );

  const handleRemoteEntryAddRefresh = useCallback(
    async (entry: RemoteEntrySession, auth: AuthMethod | null, saved_auth?: string | null) => {
      await handleRemoteEntryAdd(entry, auth, saved_auth);
      const hasAuth = remoteAuthStore.has(entry.id) || !!auth;
      if (hasAuth) {
        for (const project of entry.projects) {
          if (!project.git_info) void remoteActionsWrap.handleRefreshGit(entry.id, project.id);
        }
      }
    },
    [handleRemoteEntryAdd, remoteAuthStore, remoteActionsWrap],
  );

  return { handleWslEntryAddRefresh, handleRemoteEntryAddRefresh };
}

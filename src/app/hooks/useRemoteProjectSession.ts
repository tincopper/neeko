import { useCallback, useMemo } from 'react';

import { useConnectionStore } from '@/shared/store/connectionStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { AuthMethod, Project, RemoteEntrySession } from '@/shared/types';

export interface RemoteProjectProp {
  entryId: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
  cacheKeySuffix?: string;
  onSessionReady?: (pid: string) => void;
}

interface UseRemoteProjectSessionParams {
  activeProject: Project | null;
  remoteAuthStore: Map<string, AuthMethod>;
  activeRemoteWorktreePath: string | null;
  setRemoteOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;
  setPendingAuthEntry: React.Dispatch<React.SetStateAction<RemoteEntrySession | null>>;
}

/**
 * 远程项目会话派生逻辑：是否需要鉴权、供给 EditorGroupLayout 的 remoteProject、
 * 以及「输入凭据」动作。
 * 从 ProjectWorkspace 抽出，集中 Remote 环境判断与 store 查询。
 */
export function useRemoteProjectSession({
  activeProject,
  remoteAuthStore,
  activeRemoteWorktreePath,
  setRemoteOpenSessions,
  setPendingAuthEntry,
}: UseRemoteProjectSessionParams): {
  needsRemoteAuth: boolean;
  remoteProjectProp: RemoteProjectProp | null;
  onRemoteSessionReady: (pid: string) => void;
  handleEnterCredentials: () => void;
} {
  const onRemoteSessionReady = useCallback(
    (pid: string) => {
      setRemoteOpenSessions((prev) => new Set(prev).add(pid));
    },
    [setRemoteOpenSessions],
  );

  // Remote project needs authentication but has no credentials yet
  const needsRemoteAuth = (() => {
    if (!activeProject || activeProject.environment.type !== 'Remote') return false;
    const env = activeProject.environment;
    const entry = useConnectionStore.getState().remoteEntries.find((e) => e.host === env.host);
    return !!entry && !remoteAuthStore.has(entry.id);
  })();

  const remoteProjectProp = useMemo(() => {
    if (!activeProject || activeProject.environment.type !== 'Remote') return null;
    const env = activeProject.environment;
    const entry = useConnectionStore.getState().remoteEntries.find((e) => e.host === env.host);
    if (!entry) return null;
    const auth = remoteAuthStore.get(entry.id);
    if (!auth) return null;
    const projectPath = activeRemoteWorktreePath ?? activeProject.path;
    const cacheKeySuffix = activeRemoteWorktreePath
      ? `:wt:${btoa(activeRemoteWorktreePath).replace(/=/g, '')}`
      : '';
    return {
      entryId: entry.id,
      projectId: activeProject.id,
      projectName: activeProject.name,
      projectPath,
      host: entry.host,
      port: entry.port,
      username: entry.username,
      auth,
      cacheKeySuffix,
      onSessionReady: onRemoteSessionReady,
    };
  }, [activeProject, remoteAuthStore, activeRemoteWorktreePath, onRemoteSessionReady]);

  const handleEnterCredentials = useCallback(() => {
    const p = useProjectStore.getState().activeProject;
    if (!p) return;
    const env = p.environment;
    if (env.type === 'Remote') {
      const entry = useConnectionStore.getState().remoteEntries.find((e) => e.host === env.host);
      if (entry) setPendingAuthEntry(entry);
    }
  }, [setPendingAuthEntry]);

  return { needsRemoteAuth, remoteProjectProp, onRemoteSessionReady, handleEnterCredentials };
}

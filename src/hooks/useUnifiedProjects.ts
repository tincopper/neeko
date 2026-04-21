import { useCallback, useMemo, useRef, useEffect } from 'react';
import type { UnifiedProject, ActiveProjectAdapter, AppConfig, Project, WSLEntrySession, RemoteEntrySession, WSLProject, RemoteProject, AuthMethod, AgentConfig } from '../types';
import {
  LocalProjectAdapter,
  WslProjectAdapter,
  RemoteProjectAdapter,
  type ProjectAdapter,
} from '../adapters';

export interface UseUnifiedProjectsResult {
  projects: UnifiedProject[];
  activeProject: ActiveProjectAdapter | null;
  selectProject: (type: 'local' | 'wsl' | 'remote', projectId: string) => void;
  refreshGit: (projectId: string) => Promise<void>;
  openIde: (projectId: string, ide: string) => Promise<void>;
  setAgent: (projectId: string, agentId: string | null) => Promise<void>;
  setIde: (projectId: string, ide: string | null) => Promise<void>;
  setCollapsed: (projectId: string, collapsed: boolean) => void;
  launchAgent: (projectId: string, agent: AgentConfig) => void;
  getAdapter: (type: 'local' | 'wsl' | 'remote') => ProjectAdapter | null;
  initAdapters: (
    localProjects: Project[],
    activeProjectId: string | null,
    wslEntries: WSLEntrySession[],
    activeWslKey: { distro: string; projectId: string } | null,
    remoteEntries: RemoteEntrySession[],
    activeRemoteKey: { host: string; projectId: string } | null,
    remoteAuthStore: Map<string, AuthMethod>,
    setLocalProjects: (projects: Project[]) => void,
    setWslEntries: (entries: WSLEntrySession[]) => void,
    setRemoteEntries: (entries: RemoteEntrySession[]) => void,
    onLocalActiveChange: (project: Project | null) => void,
    onWslActiveChange: (entry: WSLEntrySession | null, project: WSLProject | null) => void,
    onRemoteActiveChange: (entry: RemoteEntrySession | null, project: RemoteProject | null) => void
  ) => void;
  updateConfig: (config: AppConfig) => void;
}

export function useUnifiedProjects(
  config: AppConfig
): UseUnifiedProjectsResult {
  const localAdapterRef = useRef<LocalProjectAdapter | null>(null);
  const wslAdapterRef = useRef<WslProjectAdapter | null>(null);
  const remoteAdapterRef = useRef<RemoteProjectAdapter | null>(null);
  const agentsRef = useRef<AgentConfig[]>(config.customAgents || []);

  useEffect(() => {
    agentsRef.current = config.customAgents || [];
  }, [config.customAgents]);

  const initAdapters = useCallback(
    (
      localProjects: Project[],
      activeProjectId: string | null,
      wslEntries: WSLEntrySession[],
      activeWslKey: { distro: string; projectId: string } | null,
      remoteEntries: RemoteEntrySession[],
      activeRemoteKey: { host: string; projectId: string } | null,
      remoteAuthStore: Map<string, AuthMethod>,
      setLocalProjects: (projects: Project[]) => void,
      setWslEntries: (entries: WSLEntrySession[]) => void,
      setRemoteEntries: (entries: RemoteEntrySession[]) => void,
      onLocalActiveChange: (project: Project | null) => void,
      onWslActiveChange: (entry: WSLEntrySession | null, project: WSLProject | null) => void,
      onRemoteActiveChange: (entry: RemoteEntrySession | null, project: RemoteProject | null) => void
    ) => {
      localAdapterRef.current = new LocalProjectAdapter(
        localProjects,
        activeProjectId,
        setLocalProjects,
        onLocalActiveChange,
        config.agentCommandOverrides ?? {}
      );

      wslAdapterRef.current = new WslProjectAdapter(
        wslEntries,
        activeWslKey,
        setWslEntries,
        onWslActiveChange,
        config.agentCommandOverrides ?? {}
      );

      remoteAdapterRef.current = new RemoteProjectAdapter(
        remoteEntries,
        activeRemoteKey,
        remoteAuthStore,
        setRemoteEntries,
        onRemoteActiveChange,
        config.agentCommandOverrides ?? {}
      );
    },
    [config.agentCommandOverrides]
  );

  const updateConfig = useCallback(
    (newConfig: AppConfig) => {
      if (localAdapterRef.current) {
        localAdapterRef.current.updateConfig(newConfig.agentCommandOverrides ?? {});
      }
      if (wslAdapterRef.current) {
        wslAdapterRef.current.updateConfig(newConfig.agentCommandOverrides ?? {});
      }
      if (remoteAdapterRef.current) {
        remoteAdapterRef.current.updateConfig(newConfig.agentCommandOverrides ?? {});
      }
      agentsRef.current = newConfig.customAgents || [];
    },
    []
  );

  const getProjects = useCallback((): UnifiedProject[] => {
    const local = localAdapterRef.current?.getProjects() ?? [];
    const wsl = wslAdapterRef.current?.getProjects() ?? [];
    const remote = remoteAdapterRef.current?.getProjects() ?? [];
    return [...local, ...wsl, ...remote];
  }, []);

  const getActiveProject = useCallback((): ActiveProjectAdapter | null => {
    const localActive = localAdapterRef.current?.getActiveProject();
    if (localActive) return { type: 'local' as const, project: localActive };

    const wslActive = wslAdapterRef.current?.getActiveProject();
    if (wslActive) {
      const wslWithDistro = wslActive as UnifiedProject & { _distro?: string };
      return {
        type: 'wsl' as const,
        distro: wslWithDistro._distro ?? '',
        project: wslActive
      };
    }

    const remoteActive = remoteAdapterRef.current?.getActiveProject();
    if (remoteActive) {
      return {
        type: 'remote' as const,
        entry: null as unknown as RemoteEntrySession,
        project: remoteActive
      };
    }

    return null;
  }, []);

  const projects = useMemo(() => getProjects(), [getProjects]);
  const activeProject = useMemo(() => getActiveProject(), [getActiveProject]);

  const selectProject = useCallback(
    (type: 'local' | 'wsl' | 'remote', projectId: string) => {
      switch (type) {
        case 'local':
          localAdapterRef.current?.selectProject(projectId);
          break;
        case 'wsl':
          wslAdapterRef.current?.selectProject(projectId);
          break;
        case 'remote':
          remoteAdapterRef.current?.selectProject(projectId);
          break;
      }
    },
    []
  );

  const refreshGit = useCallback(
    async (projectId: string) => {
      const type = projects.find(p => p.id === projectId)?.type;
      if (!type) return;
      switch (type) {
        case 'local':
          await localAdapterRef.current?.refreshGit(projectId);
          break;
        case 'wsl':
          await wslAdapterRef.current?.refreshGit(projectId);
          break;
        case 'remote':
          await remoteAdapterRef.current?.refreshGit(projectId);
          break;
      }
    },
    [projects]
  );

  const openIde = useCallback(
    async (projectId: string, ide: string) => {
      const type = projects.find(p => p.id === projectId)?.type;
      if (!type) return;
      switch (type) {
        case 'local':
          await localAdapterRef.current?.openIde(projectId, ide);
          break;
        case 'wsl':
          await wslAdapterRef.current?.openIde(projectId, ide);
          break;
        case 'remote':
          await remoteAdapterRef.current?.openIde(projectId, ide);
          break;
      }
    },
    [projects]
  );

  const setAgent = useCallback(
    async (projectId: string, agentId: string | null) => {
      const type = projects.find(p => p.id === projectId)?.type;
      if (!type) return;
      switch (type) {
        case 'local':
          await localAdapterRef.current?.setAgent(projectId, agentId);
          break;
        case 'wsl':
          await wslAdapterRef.current?.setAgent(projectId, agentId);
          break;
        case 'remote':
          await remoteAdapterRef.current?.setAgent(projectId, agentId);
          break;
      }
    },
    [projects]
  );

  const setIde = useCallback(
    async (projectId: string, ide: string | null) => {
      const type = projects.find(p => p.id === projectId)?.type;
      if (!type) return;
      switch (type) {
        case 'local':
          await localAdapterRef.current?.setIde(projectId, ide);
          break;
        case 'wsl':
          await wslAdapterRef.current?.setIde(projectId, ide);
          break;
        case 'remote':
          await remoteAdapterRef.current?.setIde(projectId, ide);
          break;
      }
    },
    [projects]
  );

  const setCollapsed = useCallback(
    (projectId: string, collapsed: boolean) => {
      const type = projects.find(p => p.id === projectId)?.type;
      if (!type) return;
      switch (type) {
        case 'local':
          localAdapterRef.current?.setCollapsed(projectId, collapsed);
          break;
        case 'wsl':
          wslAdapterRef.current?.setCollapsed(projectId, collapsed);
          break;
        case 'remote':
          remoteAdapterRef.current?.setCollapsed(projectId, collapsed);
          break;
      }
    },
    [projects]
  );

  const launchAgent = useCallback(
    (projectId: string, agent: AgentConfig) => {
      const type = projects.find(p => p.id === projectId)?.type;
      if (!type) return;
      switch (type) {
        case 'local':
          localAdapterRef.current?.launchAgent(projectId, agent);
          break;
        case 'wsl':
          wslAdapterRef.current?.launchAgent(projectId, agent);
          break;
        case 'remote':
          remoteAdapterRef.current?.launchAgent(projectId, agent);
          break;
      }
    },
    [projects]
  );

  const getAdapter = useCallback(
    (type: 'local' | 'wsl' | 'remote'): ProjectAdapter | null => {
      switch (type) {
        case 'local':
          return localAdapterRef.current;
        case 'wsl':
          return wslAdapterRef.current;
        case 'remote':
          return remoteAdapterRef.current;
        default:
          return null;
      }
    },
    []
  );

  return {
    projects,
    activeProject,
    selectProject,
    refreshGit,
    openIde,
    setAgent,
    setIde,
    setCollapsed,
    launchAgent,
    getAdapter,
    initAdapters,
    updateConfig,
  };
}

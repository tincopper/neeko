import { useEffect } from "react";
import type { ActiveRemoteKey, ActiveWslKey } from "../components/connections/types";
import type {
  AuthMethod,
  RemoteEntrySession,
  RemoteProject,
  WSLEntrySession,
  WSLProject,
} from "../types";
import { useAppStore } from "../store/appStore";

interface IdeProject {
  id: string;
  selected_ide: string | null;
}

export interface UseSyncToStoreParams {
  isTerminalView: boolean;
  wslEntries: WSLEntrySession[];
  activeWslKey: ActiveWslKey;
  activeWslProject: { distro: string; project: WSLProject } | null;
  remoteEntries: RemoteEntrySession[];
  activeRemoteKey: ActiveRemoteKey;
  activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
  remoteAuthStore: Map<string, AuthMethod>;
  pendingAuthEntry: RemoteEntrySession | null;
  worktreeState: Record<string, string>;
  selectProject: (id: string) => void;
  selectWslProject: (distro: string, project: WSLProject) => void;
  selectRemoteProject: (host: string, project: RemoteProject) => void;
  openIde: (project: IdeProject) => void;
  setProjectIde: (projectId: string, ideCommand: string | null) => void;
}

export function useSyncToStore(params: UseSyncToStoreParams): void {
  const {
    isTerminalView,
    wslEntries,
    activeWslKey,
    activeWslProject,
    remoteEntries,
    activeRemoteKey,
    activeRemoteProject,
    remoteAuthStore,
    pendingAuthEntry,
    worktreeState,
    selectProject,
    selectWslProject,
    selectRemoteProject,
    openIde,
    setProjectIde,
  } = params;

  useEffect(() => {
    useAppStore.setState({
      isTerminalView,
      wslEntries,
      activeWslKey,
      activeWslProject,
      remoteEntries,
      activeRemoteKey,
      activeRemoteProject,
      remoteAuthStore,
      pendingAuthEntry,
      worktreeState,
    });
  }, [
    isTerminalView,
    wslEntries,
    activeWslKey,
    activeWslProject,
    remoteEntries,
    activeRemoteKey,
    activeRemoteProject,
    remoteAuthStore,
    pendingAuthEntry,
    worktreeState,
  ]);

  useEffect(() => {
    useAppStore.setState({
      selectProject,
      selectWslProject,
      selectRemoteProject,
      openIde,
      setProjectIde,
    });
  }, [selectProject, selectWslProject, selectRemoteProject, openIde, setProjectIde]);
}

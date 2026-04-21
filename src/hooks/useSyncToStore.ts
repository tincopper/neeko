import { useEffect } from "react";
import type { ActiveRemoteKey, ActiveWslKey } from "../components/connections/types";
import type {
  Project,
  RemoteEntrySession,
  RemoteProject,
  WSLEntrySession,
  WSLProject,
} from "../types";
import type { WorktreeItem } from "./useWorktreeState";
import { useAppStore } from "../store/appStore";

interface IdeProject {
  id: string;
  selected_ide: string | null;
}

export interface UseSyncToStoreParams {
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;
  isTerminalView: boolean;
  wslEntries: WSLEntrySession[];
  activeWslKey: ActiveWslKey;
  remoteEntries: RemoteEntrySession[];
  activeRemoteKey: ActiveRemoteKey;
  activeWorktreePath: string | null;
  openedWorktrees: WorktreeItem[];
  wslOpenedWt: WorktreeItem[];
  activeWslWorktreePath: string | null;
  remoteOpenedWt: WorktreeItem[];
  activeRemoteWorktreePath: string | null;
  worktreeState: Record<string, string>;
  selectProject: (id: string) => void;
  selectWslProject: (distro: string, project: WSLProject) => void;
  selectRemoteProject: (host: string, project: RemoteProject) => void;
  openIde: (project: IdeProject) => void;
}

export function useSyncToStore(params: UseSyncToStoreParams): void {
  const {
    projects,
    activeProjectId,
    activeProject,
    isTerminalView,
    wslEntries,
    activeWslKey,
    remoteEntries,
    activeRemoteKey,
    activeWorktreePath,
    openedWorktrees,
    wslOpenedWt,
    activeWslWorktreePath,
    remoteOpenedWt,
    activeRemoteWorktreePath,
    worktreeState,
    selectProject,
    selectWslProject,
    selectRemoteProject,
    openIde,
  } = params;

  useEffect(() => {
    useAppStore.setState({
      projects,
      activeProjectId,
      activeProject,
      isTerminalView,
      wslEntries,
      activeWslKey,
      remoteEntries,
      activeRemoteKey,
      activeWorktreePath,
      openedWorktrees,
      wslOpenedWt,
      activeWslWorktreePath,
      remoteOpenedWt,
      activeRemoteWorktreePath,
      worktreeState,
    });
  }, [
    projects,
    activeProjectId,
    activeProject,
    isTerminalView,
    wslEntries,
    activeWslKey,
    remoteEntries,
    activeRemoteKey,
    activeWorktreePath,
    openedWorktrees,
    wslOpenedWt,
    activeWslWorktreePath,
    remoteOpenedWt,
    activeRemoteWorktreePath,
    worktreeState,
  ]);

  useEffect(() => {
    useAppStore.setState({
      selectProject,
      selectWslProject,
      selectRemoteProject,
      openIde,
    });
  }, [selectProject, selectWslProject, selectRemoteProject, openIde]);
}

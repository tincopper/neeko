import { useEffect } from "react";
import type { Project, WSLEntrySession, RemoteEntrySession } from "../types";
import type { WorktreeItem } from "./useWorktreeState";

export interface UseAppRefSyncParams {
  wslEntries: WSLEntrySession[];
  activeWslKey: { distro: string; projectId: string } | null;
  remoteEntries: RemoteEntrySession[];
  activeRemoteKey: { host: string; projectId: string } | null;
  activeWorktreePath: string | null;
  openedWorktrees: WorktreeItem[];
  activeProject: Project | null;
  wslOpenedWt: WorktreeItem[];
  activeWslWorktreePath: string | null;
  remoteOpenedWt: WorktreeItem[];
  activeRemoteWorktreePath: string | null;
  wslEntriesRef: React.MutableRefObject<WSLEntrySession[]>;
  activeWslKeyRef: React.MutableRefObject<{ distro: string; projectId: string } | null>;
  remoteEntriesRef: React.MutableRefObject<RemoteEntrySession[]>;
  activeRemoteKeyRef: React.MutableRefObject<{ host: string; projectId: string } | null>;
  activeWorktreePathRef: React.MutableRefObject<string | null>;
  openedWorktreesRef: React.MutableRefObject<WorktreeItem[]>;
  activeProjectRef: React.MutableRefObject<Project | null>;
  wslEntriesRefForSave: React.MutableRefObject<WSLEntrySession[]>;
  remoteEntriesRefForSave: React.MutableRefObject<RemoteEntrySession[]>;
  wslOpenedWtRef: React.MutableRefObject<WorktreeItem[]>;
  activeWslWorktreePathRef: React.MutableRefObject<string | null>;
  remoteOpenedWtRef: React.MutableRefObject<WorktreeItem[]>;
  activeRemoteWorktreePathRef: React.MutableRefObject<string | null>;
  isTerminalViewRef: React.MutableRefObject<boolean>;
  isTerminalView: boolean;
}

export function useAppRefSync(params: UseAppRefSyncParams): void {
  const {
    wslEntries, activeWslKey,
    remoteEntries, activeRemoteKey,
    activeWorktreePath, openedWorktrees, activeProject,
    wslOpenedWt, activeWslWorktreePath,
    remoteOpenedWt, activeRemoteWorktreePath,
    wslEntriesRef, activeWslKeyRef,
    remoteEntriesRef, activeRemoteKeyRef,
    activeWorktreePathRef, openedWorktreesRef, activeProjectRef,
    wslEntriesRefForSave, remoteEntriesRefForSave,
    wslOpenedWtRef, activeWslWorktreePathRef,
    remoteOpenedWtRef, activeRemoteWorktreePathRef,
    isTerminalViewRef, isTerminalView,
  } = params;

  useEffect(() => {
    wslEntriesRef.current = wslEntries;
    activeWslKeyRef.current = activeWslKey;
    remoteEntriesRef.current = remoteEntries;
    activeRemoteKeyRef.current = activeRemoteKey;
    activeWorktreePathRef.current = activeWorktreePath;
    openedWorktreesRef.current = openedWorktrees;
    activeProjectRef.current = activeProject;
    wslEntriesRefForSave.current = wslEntries;
    remoteEntriesRefForSave.current = remoteEntries;
    wslOpenedWtRef.current = wslOpenedWt;
    activeWslWorktreePathRef.current = activeWslWorktreePath;
    remoteOpenedWtRef.current = remoteOpenedWt;
    activeRemoteWorktreePathRef.current = activeRemoteWorktreePath;
  }, [wslEntries, activeWslKey, remoteEntries, activeRemoteKey,
      activeWorktreePath, openedWorktrees,
      activeProject, wslOpenedWt, activeWslWorktreePath,
      remoteOpenedWt, activeRemoteWorktreePath,
      wslEntriesRef, activeWslKeyRef,
      remoteEntriesRef, activeRemoteKeyRef,
      activeWorktreePathRef, openedWorktreesRef, activeProjectRef,
      wslEntriesRefForSave, remoteEntriesRefForSave,
      wslOpenedWtRef, activeWslWorktreePathRef,
      remoteOpenedWtRef, activeRemoteWorktreePathRef]);

  useEffect(() => {
    isTerminalViewRef.current = isTerminalView || activeWorktreePath !== null;
  }, [isTerminalView, activeWorktreePath, isTerminalViewRef]);
}
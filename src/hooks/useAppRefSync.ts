import { useEffect } from "react";
import type { Project, WSLEntrySession, RemoteEntrySession } from "../types";
import type { WorktreeItem } from "./useWorktreeState";

export interface UseAppRefSyncParams {
  // Values to sync
  sideTerminalOpenSet: Set<string>;
  wslEntries: WSLEntrySession[];
  activeWslKey: { distro: string; projectId: string } | null;
  remoteEntries: RemoteEntrySession[];
  activeRemoteKey: { host: string; projectId: string } | null;
  wslSideTerminalOpen: Set<string>;
  remoteSideTerminalOpen: Set<string>;
  activeWorktreePath: string | null;
  openedWorktrees: WorktreeItem[];
  activeProject: Project | null;
  wslOpenedWt: WorktreeItem[];
  activeWslWorktreePath: string | null;
  remoteOpenedWt: WorktreeItem[];
  activeRemoteWorktreePath: string | null;
  // Refs to sync into
  sideTerminalOpenSetRef: React.MutableRefObject<Set<string>>;
  wslEntriesRef: React.MutableRefObject<WSLEntrySession[]>;
  activeWslKeyRef: React.MutableRefObject<{ distro: string; projectId: string } | null>;
  remoteEntriesRef: React.MutableRefObject<RemoteEntrySession[]>;
  activeRemoteKeyRef: React.MutableRefObject<{ host: string; projectId: string } | null>;
  wslSideOpenRef: React.MutableRefObject<Set<string>>;
  remoteSideOpenRef: React.MutableRefObject<Set<string>>;
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
    sideTerminalOpenSet,
    wslEntries, activeWslKey,
    remoteEntries, activeRemoteKey,
    wslSideTerminalOpen, remoteSideTerminalOpen,
    activeWorktreePath, openedWorktrees, activeProject,
    wslOpenedWt, activeWslWorktreePath,
    remoteOpenedWt, activeRemoteWorktreePath,
    sideTerminalOpenSetRef,
    wslEntriesRef, activeWslKeyRef,
    remoteEntriesRef, activeRemoteKeyRef,
    wslSideOpenRef, remoteSideOpenRef,
    activeWorktreePathRef, openedWorktreesRef, activeProjectRef,
    wslEntriesRefForSave, remoteEntriesRefForSave,
    wslOpenedWtRef, activeWslWorktreePathRef,
    remoteOpenedWtRef, activeRemoteWorktreePathRef,
    isTerminalViewRef, isTerminalView,
  } = params;

  // Ref sync
  useEffect(() => {
    sideTerminalOpenSetRef.current = sideTerminalOpenSet;
    wslEntriesRef.current = wslEntries;
    activeWslKeyRef.current = activeWslKey;
    remoteEntriesRef.current = remoteEntries;
    activeRemoteKeyRef.current = activeRemoteKey;
    wslSideOpenRef.current = wslSideTerminalOpen;
    remoteSideOpenRef.current = remoteSideTerminalOpen;
    activeWorktreePathRef.current = activeWorktreePath;
    openedWorktreesRef.current = openedWorktrees;
    activeProjectRef.current = activeProject;
    wslEntriesRefForSave.current = wslEntries;
    remoteEntriesRefForSave.current = remoteEntries;
    wslOpenedWtRef.current = wslOpenedWt;
    activeWslWorktreePathRef.current = activeWslWorktreePath;
    remoteOpenedWtRef.current = remoteOpenedWt;
    activeRemoteWorktreePathRef.current = activeRemoteWorktreePath;
  }, [sideTerminalOpenSet, wslEntries, activeWslKey, remoteEntries, activeRemoteKey,
      wslSideTerminalOpen, remoteSideTerminalOpen, activeWorktreePath, openedWorktrees,
      activeProject, wslOpenedWt, activeWslWorktreePath,
      remoteOpenedWt, activeRemoteWorktreePath,
      sideTerminalOpenSetRef, wslEntriesRef, activeWslKeyRef,
      remoteEntriesRef, activeRemoteKeyRef, wslSideOpenRef, remoteSideOpenRef,
      activeWorktreePathRef, openedWorktreesRef, activeProjectRef,
      wslEntriesRefForSave, remoteEntriesRefForSave,
      wslOpenedWtRef, activeWslWorktreePathRef,
      remoteOpenedWtRef, activeRemoteWorktreePathRef]);

  // isTerminalView ref sync
  useEffect(() => {
    isTerminalViewRef.current = isTerminalView || activeWorktreePath !== null;
  }, [isTerminalView, activeWorktreePath, isTerminalViewRef]);
}

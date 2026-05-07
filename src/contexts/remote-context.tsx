import React, { createContext, useContext } from "react";
import type { ActiveRemoteKey } from "../components/connections/types";
import type { AuthMethod, RemoteEntrySession, RemoteProject } from "../types";

export interface RemoteDiffState {
  entryId: string;
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
  projectPath: string;
  filePath: string;
}

export interface RemoteContextValue {
  remoteEntries: RemoteEntrySession[];
  activeRemoteKey: ActiveRemoteKey;
  remoteOpenSessions: Set<string>;
  activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
  activeRemoteWorktreePath: string | null;
  remoteAuthStore: Map<string, AuthMethod>;
  remoteDiffState: RemoteDiffState | null;
  setRemoteOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;
  onSelectRemoteProject: (host: string, project: RemoteProject) => void;
  onCloseRemoteProject: (entryId: string, projectId: string) => void;
  onRemoveRemoteProject: (entryId: string, projectId: string) => void;
  onRemoveRemoteEntry: (entryId: string) => void;
  onAddRemoteProject: (entryId: string) => void;
  onSelectRemoteFile?: (entryId: string, projectPath: string, filePath: string) => void;
  onRefreshRemoteGit?: (entryId: string, projectId: string, projectPath: string) => void;
  onOpenRemoteIde?: (entryId: string, projectPath: string, ide: string) => void;
  onOpenRemoteWorktreeTerminal?: (
    entryId: string,
    worktreePath: string,
    branch: string,
  ) => void;
   invokeRemoteGit?: (
    command: string,
    entryId: string,
    extra: Record<string, unknown>,
  ) => Promise<unknown>;
   onRemoteDiffBack: () => void;
   onRemoteDragEnd?: (entryId: string, draggedId: string, targetId: string) => void;
   setPendingAuthEntry: React.Dispatch<React.SetStateAction<RemoteEntrySession | null>>;
}

const RemoteContext = createContext<RemoteContextValue | null>(null);

export function RemoteProvider({
  value,
  children,
}: {
  value: RemoteContextValue;
  children: React.ReactNode;
}) {
  return (
    <RemoteContext.Provider value={value}>{children}</RemoteContext.Provider>
  );
}

export function useRemoteContext() {
  const ctx = useContext(RemoteContext);
  if (!ctx) {
    throw new Error("useRemoteContext must be used within RemoteProvider");
  }
  return ctx;
}

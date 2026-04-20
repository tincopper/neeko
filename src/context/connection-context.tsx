import React, { createContext, useContext } from "react";
import type { ActiveRemoteKey } from "../hooks/useRemoteProjects";
import type { ActiveWslKey } from "../components/connections";
import type { AuthMethod, RemoteEntrySession, RemoteProject, WSLEntrySession, WSLProject } from "../types";

interface ConnectionContextValue {
   wslEntries: WSLEntrySession[];
   remoteEntries: RemoteEntrySession[];
   activeWslKey: ActiveWslKey;
   activeRemoteKey: ActiveRemoteKey;
   wslOpenSessions: Set<string>;
   remoteOpenSessions: Set<string>;

   onSelectWslProject: (distro: string, project: WSLProject) => void;
   onCloseWslProject: (entryId: string, projectId: string) => void;
   onRemoveWslProject: (entryId: string, projectId: string) => void;
   onRemoveWslEntry: (entryId: string) => void;
   onAddWslProject: (entryId: string) => void;

   onSelectRemoteProject: (host: string, project: RemoteProject) => void;
   onCloseRemoteProject: (entryId: string, projectId: string) => void;
   onRemoveRemoteProject: (entryId: string, projectId: string) => void;
   onRemoveRemoteEntry: (entryId: string) => void;
   onAddRemoteProject: (entryId: string) => void;

   onSelectWslFile?: (distro: string, projectPath: string, filePath: string) => void;
   onSelectRemoteFile?: (entryId: string, projectPath: string, filePath: string) => void;
   onRefreshWslGit?: (distro: string, projectId: string, projectPath: string) => void;
   onRefreshRemoteGit?: (entryId: string, projectId: string, projectPath: string) => void;
   onOpenWslIde?: (distro: string, projectPath: string, ide: string) => void;
   onOpenRemoteIde?: (entryId: string, projectPath: string, ide: string) => void;
   onOpenWslWorktreeTerminal?: (distro: string, worktreePath: string, branch: string) => void;
   onOpenRemoteWorktreeTerminal?: (entryId: string, worktreePath: string, branch: string) => void;
   invokeRemoteGit?: (command: string, entryId: string, extra: Record<string, unknown>) => Promise<unknown>;

   activeWslProject: { distro: string; project: WSLProject } | null;
   activeWslWorktreePath: string | null;
   setWslOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;

   activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
   activeRemoteWorktreePath: string | null;
   remoteAuthStore: Map<string, AuthMethod>;
   setRemoteOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;

   wslDiffState: { distro: string; projectPath: string; filePath: string } | null;
   remoteDiffState: {
      entryId: string;
      host: string;
      port: number;
      username: string;
      auth: AuthMethod;
      projectPath: string;
      filePath: string;
   } | null;
   onWslDiffBack: () => void;
   onRemoteDiffBack: () => void;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({
   value,
   children,
}: {
   value: ConnectionContextValue;
   children: React.ReactNode;
}) {
   return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnectionContext() {
   const ctx = useContext(ConnectionContext);
   if (!ctx) {
      throw new Error("useConnectionContext must be used within ConnectionProvider");
   }
   return ctx;
}

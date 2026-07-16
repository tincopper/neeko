import React, { createContext, useContext } from "react";
import type { AuthMethod, RemoteEntrySession, WSLEntrySession } from "@/shared/types";

// ── WSL-specific types ────────────────────────────────────────────────────

export interface WslContextValue {
  wslEntries: WSLEntrySession[];
  wslOpenSessions: Set<string>;
  activeWslWorktreePath: string | null;
  wslDiffState: { distro: string; projectPath: string; filePath: string } | null;
  setWslOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;
  onCloseWslProject: (entryId: string, projectId: string) => void;
  onRemoveWslProject: (entryId: string, projectId: string) => void;
  onRemoveWslEntry: (entryId: string) => void;
  onAddWslProject: (entryId: string) => void;
  onSelectWslFile?: (distro: string, projectPath: string, filePath: string) => void;
  onRefreshWslGit?: (distro: string, projectId: string, projectPath: string) => void;
  onOpenWslIde?: (distro: string, projectPath: string, ide: string) => void;
  onOpenWslWorktreeTerminal?: (distro: string, worktreePath: string, branch: string) => void;
  onWslDiffBack: () => void;
  onWslDragEnd?: (entryId: string, draggedId: string, targetId: string) => void;
}

// ── Remote-specific types ─────────────────────────────────────────────────

export interface RemoteContextValue {
  remoteEntries: RemoteEntrySession[];
  remoteOpenSessions: Set<string>;
  activeRemoteWorktreePath: string | null;
  remoteAuthStore: Map<string, AuthMethod>;
  setRemoteOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;
  onCloseRemoteProject: (entryId: string, projectId: string) => void;
  onRemoveRemoteProject: (entryId: string, projectId: string) => void;
  onRemoveRemoteEntry: (entryId: string) => void;
  onAddRemoteProject: (entryId: string) => void;
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
  onRemoteDragEnd?: (entryId: string, draggedId: string, targetId: string) => void;
  setPendingAuthEntry: React.Dispatch<React.SetStateAction<RemoteEntrySession | null>>;
}

// ── Unified context value (combines WSL + Remote) ─────────────────────────

export interface ConnectionProjectContextValue extends WslContextValue, RemoteContextValue {}

// ── Context ───────────────────────────────────────────────────────────────

const ConnectionProjectContext = createContext<ConnectionProjectContextValue | null>(null);

export function ConnectionProjectProvider({
  value,
  children,
}: {
  value: ConnectionProjectContextValue;
  children: React.ReactNode;
}) {
  return (
    <ConnectionProjectContext.Provider value={value}>
      {children}
    </ConnectionProjectContext.Provider>
  );
}

export function useConnectionProjectContext() {
  const ctx = useContext(ConnectionProjectContext);
  if (!ctx) {
    throw new Error(
      "useConnectionProjectContext must be used within ConnectionProjectProvider",
    );
  }
  return ctx;
}

import React, { createContext, useContext } from "react";
import type { ActiveWslKey } from "../components/connections/types";
import type { WSLEntrySession, WSLProject } from "../types";

export interface WslContextValue {
  wslEntries: WSLEntrySession[];
  activeWslKey: ActiveWslKey;
  wslOpenSessions: Set<string>;
  activeWslProject: { distro: string; project: WSLProject } | null;
  activeWslWorktreePath: string | null;
  wslDiffState: { distro: string; projectPath: string; filePath: string } | null;
  setWslOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;
  onSelectWslProject: (distro: string, project: WSLProject) => void;
  onCloseWslProject: (entryId: string, projectId: string) => void;
  onRemoveWslProject: (entryId: string, projectId: string) => void;
  onRemoveWslEntry: (entryId: string) => void;
  onAddWslProject: (entryId: string) => void;
  onSelectWslFile?: (distro: string, projectPath: string, filePath: string) => void;
  onRefreshWslGit?: (distro: string, projectId: string, projectPath: string) => void;
  onOpenWslIde?: (distro: string, projectPath: string, ide: string) => void;
  onOpenWslWorktreeTerminal?: (distro: string, worktreePath: string, branch: string) => void;
  onWslDiffBack: () => void;
}

const WslContext = createContext<WslContextValue | null>(null);

export function WslProvider({
  value,
  children,
}: {
  value: WslContextValue;
  children: React.ReactNode;
}) {
  return <WslContext.Provider value={value}>{children}</WslContext.Provider>;
}

export function useWslContext() {
  const ctx = useContext(WslContext);
  if (!ctx) {
    throw new Error("useWslContext must be used within WslProvider");
  }
  return ctx;
}

import React, { createContext, useContext } from "react";
import type { WSLEntrySession } from '@/shared/types';

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

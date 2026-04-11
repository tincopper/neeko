import { useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WSLEntrySession, RemoteEntrySession } from "../types";
import type { SaveSessionFn } from "./useWslProjects";

export interface UseSessionPersistenceResult {
  // Refs (for external sync)
  wslEntriesRefForSave: React.MutableRefObject<WSLEntrySession[]>;
  remoteEntriesRefForSave: React.MutableRefObject<RemoteEntrySession[]>;
  worktreeStateRef: React.MutableRefObject<Record<string, string>>;
  // Session save
  saveSession: SaveSessionFn;
  saveWorktreeState: (projectId: string, wtPath: string | null) => void;
  // Width persistence
  saveSidebarWidth: (width: number) => void;
  saveSideTerminalWidth: (width: number) => void;
}

export function useSessionPersistence(): UseSessionPersistenceResult {
  const wslEntriesRefForSave = useRef<WSLEntrySession[]>([]);
  const remoteEntriesRefForSave = useRef<RemoteEntrySession[]>([]);
  const worktreeStateRef = useRef<Record<string, string>>({});
  const wtSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveWorktreeState = useCallback((projectId: string, wtPath: string | null) => {
    if (wtPath) {
      worktreeStateRef.current[projectId] = wtPath;
    } else {
      delete worktreeStateRef.current[projectId];
    }
    if (wtSaveTimerRef.current) clearTimeout(wtSaveTimerRef.current);
    wtSaveTimerRef.current = setTimeout(() => {
      invoke("save_session", { worktreeState: worktreeStateRef.current }).catch(() => {});
    }, 500);
  }, []);

  const saveSession: SaveSessionFn = useCallback(async (wslEntriesParam?: WSLEntrySession[], remoteEntriesParam?: RemoteEntrySession[]) => {
    const wsl = wslEntriesParam ?? wslEntriesRefForSave.current;
    const remote = remoteEntriesParam ?? remoteEntriesRefForSave.current;
    await invoke("save_session", { wslEntries: wsl, remoteEntries: remote });
  }, []);

  const sidebarWidthSaveTimeout = useRef<ReturnType<typeof setTimeout>>();

  const saveSessionPartial = useCallback((opts: { sidebarWidth?: number | null; sideTerminalWidth?: number | null }) => {
    invoke("save_session", {
      wslEntries: wslEntriesRefForSave.current,
      remoteEntries: remoteEntriesRefForSave.current,
      sidebarWidth: opts.sidebarWidth ?? null,
      sideTerminalWidth: opts.sideTerminalWidth ?? null,
    }).catch(console.error);
  }, []);

  const saveSidebarWidth = useCallback((width: number) => {
    clearTimeout(sidebarWidthSaveTimeout.current);
    sidebarWidthSaveTimeout.current = setTimeout(() => {
      saveSessionPartial({ sidebarWidth: width });
    }, 300);
  }, [saveSessionPartial]);

  const saveSideTerminalWidth = useCallback((width: number) => {
    saveSessionPartial({ sideTerminalWidth: Math.round(width) });
  }, [saveSessionPartial]);

  return {
    wslEntriesRefForSave,
    remoteEntriesRefForSave,
    worktreeStateRef,
    saveSession,
    saveWorktreeState,
    saveSidebarWidth,
    saveSideTerminalWidth,
  };
}

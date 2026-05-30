import { useState, useRef, useCallback } from "react";
import { saveSession as saveSessionApi } from "../api/sessionApi";
import type { WSLEntrySession, RemoteEntrySession } from "../../../types";
import type { SaveSessionFn } from "../../connection/hooks/useWslProjects";
import { useConnectionStore } from '@/features/connection/store';

export interface UseSessionPersistenceResult {
   worktreeState: Record<string, string>;
   restoreWorktreeState: (next: Record<string, string>) => void;
   saveSession: SaveSessionFn;
   saveWorktreeState: (projectId: string, wtPath: string | null) => void;
   saveSidebarWidth: (width: number) => void;
}

export function useSessionPersistence(): UseSessionPersistenceResult {
   const [worktreeState, setWorktreeState] = useState<Record<string, string>>({});
   const wtSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

   const persistWorktreeState = useCallback((next: Record<string, string>) => {
      if (wtSaveTimerRef.current) clearTimeout(wtSaveTimerRef.current);
      wtSaveTimerRef.current = setTimeout(() => {
         saveSessionApi([], [], null, next).catch(() => { });
      }, 500);
   }, []);

   const restoreWorktreeState = useCallback((next: Record<string, string>) => {
      setWorktreeState(next);
   }, []);

   const saveWorktreeState = useCallback((projectId: string, wtPath: string | null) => {
      setWorktreeState((prev) => {
         const next = { ...prev };
         if (wtPath) {
            next[projectId] = wtPath;
         } else {
            delete next[projectId];
         }
         persistWorktreeState(next);
         return next;
      });
   }, [persistWorktreeState]);

   const saveSession: SaveSessionFn = useCallback(async (wslEntriesParam?: WSLEntrySession[], remoteEntriesParam?: RemoteEntrySession[]) => {
      const snapshot = useConnectionStore.getState();
      const wsl = wslEntriesParam ?? snapshot.wslEntries;
      const remote = remoteEntriesParam ?? snapshot.remoteEntries;
      await saveSessionApi(wsl, remote);
   }, []);

   const sidebarWidthSaveTimeout = useRef<ReturnType<typeof setTimeout>>();

   const saveSessionPartial = useCallback((opts: { sidebarWidth?: number | null }) => {
      const snapshot = useConnectionStore.getState();
      saveSessionApi(snapshot.wslEntries, snapshot.remoteEntries, opts.sidebarWidth ?? null).catch(console.error);
   }, []);

   const saveSidebarWidth = useCallback((width: number) => {
      clearTimeout(sidebarWidthSaveTimeout.current);
      sidebarWidthSaveTimeout.current = setTimeout(() => {
         saveSessionPartial({ sidebarWidth: width });
      }, 300);
   }, [saveSessionPartial]);


   return {
      worktreeState,
      restoreWorktreeState,
      saveSession,
      saveWorktreeState,
      saveSidebarWidth,
   };
}

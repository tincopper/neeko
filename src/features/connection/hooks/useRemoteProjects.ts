import { useState, useCallback, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { remoteCacheKey, destroyRemoteCachesByPrefix } from "@/features/terminal/components/terminalCache";
import type { RemoteEntrySession, AuthMethod } from '@/shared/types';
import type { SaveSessionFn } from "./useWslProjects";
import { useProjectStore } from "@/features/project/store";
import { useConnectionStore } from "../store";
import { useShallow } from "zustand/shallow";
import { applyStateAction, upsertEntryById } from '@/shared/utils/entryUpdates';

export function useRemoteProjects(saveSession: SaveSessionFn, showToast: (message: string, type?: "info" | "error") => void) {
  const remoteEntries = useConnectionStore(useShallow((state) => state.remoteEntries));
  const remoteAuthStore = useConnectionStore((state) => state.remoteAuthStore);
  const pendingAuthEntry = useConnectionStore((state) => state.pendingAuthEntry);

  const setRemoteEntries: Dispatch<SetStateAction<RemoteEntrySession[]>> = useCallback((updater) => {
    useConnectionStore.setState((state) => ({
      remoteEntries: applyStateAction(state.remoteEntries, updater),
    }));
  }, []);

  const setRemoteAuthStore: Dispatch<SetStateAction<Map<string, AuthMethod>>> = useCallback((updater) => {
    useConnectionStore.setState((state) => ({
      remoteAuthStore: applyStateAction(state.remoteAuthStore, updater),
    }));
  }, []);

  const setPendingAuthEntry: Dispatch<SetStateAction<RemoteEntrySession | null>> = useCallback((updater) => {
    useConnectionStore.setState((state) => ({
      pendingAuthEntry: applyStateAction(state.pendingAuthEntry, updater),
    }));
  }, []);

  const [remoteOpenSessions, setRemoteOpenSessions] = useState<Set<string>>(new Set());
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [remoteAddToEntryId, setRemoteAddToEntryId] = useState<string | null>(null);

  // Trigger SSH auth dialog when a Remote project is active without credentials
  useEffect(() => {
    const activeProject = useProjectStore.getState().activeProject;
    if (!activeProject) { setPendingAuthEntry(null); return; }
    const env = activeProject.environment;
    if (env.type !== 'Remote') { setPendingAuthEntry(null); return; }
    const entry = remoteEntries.find(e => e.host === env.host);
    if (!entry) { setPendingAuthEntry(null); return; }
    if (!remoteAuthStore.has(entry.id)) {
      setPendingAuthEntry(entry);
    } else {
      setPendingAuthEntry(null);
    }
  }, [remoteEntries, remoteAuthStore, setPendingAuthEntry]);

  const handleRemoteEntryAdd = useCallback(async (entry: RemoteEntrySession, auth: AuthMethod | null, saved_auth?: string | null) => {
    try {
      // 如果�?saved_auth，写�?entry 用于持久�?
      const persistEntry = saved_auth ? { ...entry, saved_auth } : entry;
      const newEntries = upsertEntryById(remoteEntries, persistEntry);
      setRemoteEntries(newEntries);
      await saveSession(undefined, newEntries);
      if (auth) {
        setRemoteAuthStore(prev => new Map(prev).set(entry.id, auth));
      }
    } catch (error) {
      console.error("[App] Failed to save remote entry:", error);
    }
  }, [remoteEntries, setRemoteEntries, saveSession, setRemoteAuthStore]);

  const handleCloseRemoteProject = useCallback((entryId: string, projectId: string) => {
    destroyRemoteCachesByPrefix(remoteCacheKey(entryId, projectId));
    const activeId = useProjectStore.getState().activeProjectId;
    if (activeId === projectId) {
      useProjectStore.setState({ activeProjectId: null, activeProject: null });
    }
    setRemoteOpenSessions(prev => { const n = new Set(prev); n.delete(projectId); return n; });
  }, []);

  const handleRemoveRemoteProject = useCallback(async (entryId: string, projectId: string) => {
    destroyRemoteCachesByPrefix(remoteCacheKey(entryId, projectId));
    const activeId = useProjectStore.getState().activeProjectId;
    if (activeId === projectId) {
      useProjectStore.setState({ activeProjectId: null, activeProject: null });
    }
    setRemoteOpenSessions(prev => { const n = new Set(prev); n.delete(projectId); return n; });
    const newEntries = remoteEntries.map(e => {
      if (e.id !== entryId) return e;
      return { ...e, projects: e.projects.filter(p => p.id !== projectId) };
    });
    setRemoteEntries(newEntries);
    await saveSession(undefined, newEntries).catch(console.error);
  }, [remoteEntries, setRemoteEntries, saveSession]);

  const handleRemoveRemoteEntry = useCallback(async (entryId: string) => {
    const entry = remoteEntries.find(e => e.id === entryId);
    if (entry) {
      entry.projects.forEach(p => {
        destroyRemoteCachesByPrefix(remoteCacheKey(entryId, p.id));
      });
      const activeId = useProjectStore.getState().activeProjectId;
      if (activeId && entry.projects.some(p => p.id === activeId)) {
        useProjectStore.setState({ activeProjectId: null, activeProject: null });
      }
      setRemoteAuthStore(prev => { const next = new Map(prev); next.delete(entryId); return next; });
    }
    const newEntries = remoteEntries.filter(e => e.id !== entryId);
    setRemoteEntries(newEntries);
    await saveSession(undefined, newEntries).catch(console.error);
  }, [remoteEntries, setRemoteEntries, setRemoteAuthStore, saveSession]);

  const handleAddRemoteProject = useCallback((entryId: string) => {
    setRemoteAddToEntryId(entryId);
    setRemoteDialogOpen(true);
  }, []);

  const handleRemoteDialogClose = useCallback(() => {
    setRemoteDialogOpen(false);
    setRemoteAddToEntryId(null);
  }, []);

  const handleRemoteDragEnd = useCallback((entryId: string, draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;

    setRemoteEntries((prev) => {
      const newEntries = prev.map((entry) => {
        if (entry.id !== entryId) return entry;

        const projects = [...entry.projects];
        const draggedIndex = projects.findIndex((p) => p.id === draggedId);
        const targetIndex = projects.findIndex((p) => p.id === targetId);

        if (draggedIndex < 0 || targetIndex < 0) return entry;

        const [dragged] = projects.splice(draggedIndex, 1);
        projects.splice(targetIndex, 0, dragged);

        return { ...entry, projects };
      });

      // Persist the new order
      saveSession(undefined, newEntries).catch((e) =>
        console.error("[Remote] Failed to persist project order:", e)
      );

      return newEntries;
    });
  }, [saveSession]);

  /** 从持久化�?saved_auth 恢复 remoteAuthStore（同步更�?store�?*/
  const restoreAuthFromEntries = useCallback((entries: RemoteEntrySession[]) => {
    const restored = new Map<string, AuthMethod>();
    for (const entry of entries) {
      if (entry.saved_auth) {
        try {
          const auth: AuthMethod = JSON.parse(atob(entry.saved_auth));
          restored.set(entry.id, auth);
        } catch (e) {
          console.warn(`[Remote] Failed to parse saved_auth for entry ${entry.id}:`, e);
          showToast(`Failed to restore credentials for ${entry.host}:${entry.port}. Please re-enter.`, "error");
        }
      }
    }
    if (restored.size > 0) {
      // 使用 useAppStore.setState 直接同步更新，确保在 setInitializing(false) 之前 store 已就�?
      useConnectionStore.setState((state) => {
        const merged = new Map(state.remoteAuthStore);
        for (const [k, v] of restored) merged.set(k, v);
        return { remoteAuthStore: merged };
      });
    }
  }, [showToast]);

  return {
    remoteEntries, setRemoteEntries,
    remoteOpenSessions, setRemoteOpenSessions,
    remoteDialogOpen, setRemoteDialogOpen,
    remoteAddToEntryId,
    remoteAuthStore, setRemoteAuthStore,
    pendingAuthEntry, setPendingAuthEntry,
    handleRemoteEntryAdd,
    handleCloseRemoteProject, handleRemoveRemoteProject, handleRemoveRemoteEntry,
    handleAddRemoteProject, handleRemoteDialogClose,
    handleRemoteDragEnd,
    restoreAuthFromEntries,
  };
}

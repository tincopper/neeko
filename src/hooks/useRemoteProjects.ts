import { useState, useCallback, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { remoteCacheKey, destroyRemoteCachesByPrefix } from "../components/terminal";
import type { RemoteEntrySession, RemoteProject, AuthMethod } from "../types";
import type { SaveSessionFn } from "./useWslProjects";
import type { ActiveRemoteKey } from "../components/connections/types";
import { useAppStore } from "../store/appStore";
import { useShallow } from "zustand/shallow";
import { applyStateAction, upsertEntryById } from "../utils/entryUpdates";

export type { ActiveRemoteKey };

export function useRemoteProjects(saveSession: SaveSessionFn, showToast: (message: string, type?: "info" | "error") => void) {
  const remoteEntries = useAppStore(useShallow((state) => state.remoteEntries));
  const activeRemoteKey = useAppStore((state) => state.activeRemoteKey);
  const activeRemoteProject = useAppStore((state) => state.activeRemoteProject);
  const remoteAuthStore = useAppStore((state) => state.remoteAuthStore);
  const pendingAuthEntry = useAppStore((state) => state.pendingAuthEntry);

  const setRemoteEntries: Dispatch<SetStateAction<RemoteEntrySession[]>> = useCallback((updater) => {
    useAppStore.setState((state) => ({
      remoteEntries: applyStateAction(state.remoteEntries, updater),
    }));
  }, []);

  const setActiveRemoteKey: Dispatch<SetStateAction<ActiveRemoteKey>> = useCallback((updater) => {
    useAppStore.setState((state) => ({
      activeRemoteKey: applyStateAction(state.activeRemoteKey, updater),
    }));
  }, []);

  const setActiveRemoteProject: Dispatch<SetStateAction<{
    entry: RemoteEntrySession;
    project: RemoteProject;
  } | null>> = useCallback((updater) => {
    useAppStore.setState((state) => ({
      activeRemoteProject: applyStateAction(state.activeRemoteProject, updater),
    }));
  }, []);

  const setRemoteAuthStore: Dispatch<SetStateAction<Map<string, AuthMethod>>> = useCallback((updater) => {
    useAppStore.setState((state) => ({
      remoteAuthStore: applyStateAction(state.remoteAuthStore, updater),
    }));
  }, []);

  const setPendingAuthEntry: Dispatch<SetStateAction<RemoteEntrySession | null>> = useCallback((updater) => {
    useAppStore.setState((state) => ({
      pendingAuthEntry: applyStateAction(state.pendingAuthEntry, updater),
    }));
  }, []);

  const [remoteOpenSessions, setRemoteOpenSessions] = useState<Set<string>>(new Set());
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [remoteAddToEntryId, setRemoteAddToEntryId] = useState<string | null>(null);

  // Trigger SSH auth dialog via effect (only depend on activeRemoteProject to avoid
  // unnecessary re-triggers when remoteAuthStore Map reference changes)
  useEffect(() => {
    if (!activeRemoteProject) {
      setPendingAuthEntry(null);
      return;
    }
    // Read auth store directly to avoid Map reference dependency
    const hasAuth = useAppStore.getState().remoteAuthStore.has(activeRemoteProject.entry.id);
    if (!hasAuth) {
      setPendingAuthEntry(activeRemoteProject.entry);
    } else {
      setPendingAuthEntry(null);
    }
  }, [activeRemoteProject, setPendingAuthEntry]);

  const handleRemoteEntryAdd = useCallback(async (entry: RemoteEntrySession, auth: AuthMethod | null, saved_auth?: string | null) => {
    try {
      // 如果有 saved_auth，写入 entry 用于持久化
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
    if (activeRemoteKey?.projectId === projectId) {
      setActiveRemoteKey(null);
      setActiveRemoteProject(null);
    }
    setRemoteOpenSessions(prev => { const n = new Set(prev); n.delete(projectId); return n; });
  }, [activeRemoteKey, setActiveRemoteKey, setActiveRemoteProject]);

  const handleRemoveRemoteProject = useCallback(async (entryId: string, projectId: string) => {
    destroyRemoteCachesByPrefix(remoteCacheKey(entryId, projectId));
    if (activeRemoteKey?.projectId === projectId) {
      setActiveRemoteKey(null);
      setActiveRemoteProject(null);
    }
    setRemoteOpenSessions(prev => { const n = new Set(prev); n.delete(projectId); return n; });
    const newEntries = remoteEntries.map(e => {
      if (e.id !== entryId) return e;
      return { ...e, projects: e.projects.filter(p => p.id !== projectId) };
    });
    setRemoteEntries(newEntries);
    await saveSession(undefined, newEntries).catch(console.error);
  }, [remoteEntries, activeRemoteKey, setActiveRemoteKey, setActiveRemoteProject, setRemoteEntries, saveSession]);

  const handleRemoveRemoteEntry = useCallback(async (entryId: string) => {
    const entry = remoteEntries.find(e => e.id === entryId);
    if (entry) {
      entry.projects.forEach(p => {
        destroyRemoteCachesByPrefix(remoteCacheKey(entryId, p.id));
      });
      if (activeRemoteKey && entry.projects.some(p => p.id === activeRemoteKey.projectId)) {
        setActiveRemoteKey(null);
        setActiveRemoteProject(null);
      }
      setRemoteAuthStore(prev => { const next = new Map(prev); next.delete(entryId); return next; });
    }
    const newEntries = remoteEntries.filter(e => e.id !== entryId);
    setRemoteEntries(newEntries);
    await saveSession(undefined, newEntries).catch(console.error);
  }, [remoteEntries, activeRemoteKey, setActiveRemoteKey, setActiveRemoteProject, setRemoteEntries, setRemoteAuthStore, saveSession]);

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

  /** 从持久化的 saved_auth 恢复 remoteAuthStore（同步更新 store） */
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
      // 使用 useAppStore.setState 直接同步更新，确保在 setInitializing(false) 之前 store 已就绪
      useAppStore.setState((state) => {
        const merged = new Map(state.remoteAuthStore);
        for (const [k, v] of restored) merged.set(k, v);
        return { remoteAuthStore: merged };
      });
    }
  }, [showToast]);

  return {
    remoteEntries, setRemoteEntries,
    activeRemoteKey, setActiveRemoteKey,
    activeRemoteProject, setActiveRemoteProject,
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

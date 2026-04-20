import { useState, useRef, useCallback, useEffect } from "react";
import { remoteCacheKey, destroyRemoteCachesByPrefix } from "../components/terminal";
import type { RemoteEntrySession, RemoteProject, AuthMethod } from "../types";
import type { SaveSessionFn } from "./useWslProjects";
import type { ActiveRemoteKey } from "../components/connections/types";

export type { ActiveRemoteKey };

export function useRemoteProjects(saveSession: SaveSessionFn) {
  const [remoteEntries, setRemoteEntries] = useState<RemoteEntrySession[]>([]);
  const [activeRemoteKey, setActiveRemoteKey] = useState<ActiveRemoteKey>(null);
  const [activeRemoteProject, setActiveRemoteProject] = useState<{
    entry: RemoteEntrySession;
    project: RemoteProject;
  } | null>(null);
  const [remoteOpenSessions, setRemoteOpenSessions] = useState<Set<string>>(new Set());
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [remoteAddToEntryId, setRemoteAddToEntryId] = useState<string | null>(null);
  const [remoteAuthStore, setRemoteAuthStore] = useState<Map<string, AuthMethod>>(new Map());
  const [pendingAuthEntry, setPendingAuthEntry] = useState<RemoteEntrySession | null>(null);

  const remoteEntriesRef = useRef<RemoteEntrySession[]>([]);
  const activeRemoteKeyRef = useRef<ActiveRemoteKey>(null);
  const selectRemoteProjectRef = useRef<(host: string, project: RemoteProject) => void>(() => {});

  // Trigger SSH auth dialog via effect
  useEffect(() => {
    if (!activeRemoteProject) {
      setPendingAuthEntry(null);
      return;
    }
    const hasAuth = remoteAuthStore.has(activeRemoteProject.entry.id);
    if (!hasAuth) {
      setPendingAuthEntry(activeRemoteProject.entry);
    } else {
      setPendingAuthEntry(null);
    }
  }, [activeRemoteProject, remoteAuthStore]);

  const handleRemoteEntryAdd = useCallback(async (entry: RemoteEntrySession, auth: AuthMethod | null, saved_auth?: string | null) => {
    try {
      // 如果有 saved_auth，写入 entry 用于持久化
      const persistEntry = saved_auth ? { ...entry, saved_auth } : entry;
      const existingIndex = remoteEntries.findIndex(e => e.id === entry.id);
      let newEntries: RemoteEntrySession[];
      if (existingIndex >= 0) {
        newEntries = [...remoteEntries];
        newEntries[existingIndex] = persistEntry;
      } else {
        newEntries = [...remoteEntries, persistEntry];
      }
      setRemoteEntries(newEntries);
      await saveSession(undefined, newEntries);
      if (auth) {
        setRemoteAuthStore(prev => new Map(prev).set(entry.id, auth));
      }
    } catch (error) {
      console.error("[App] Failed to save remote entry:", error);
    }
  }, [remoteEntries, saveSession]);

  const handleCloseRemoteProject = useCallback((entryId: string, projectId: string) => {
    destroyRemoteCachesByPrefix(remoteCacheKey(entryId, projectId));
    if (activeRemoteKey?.projectId === projectId) {
      setActiveRemoteKey(null);
      setActiveRemoteProject(null);
    }
    setRemoteOpenSessions(prev => { const n = new Set(prev); n.delete(projectId); return n; });
  }, [activeRemoteKey]);

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
  }, [remoteEntries, activeRemoteKey, saveSession]);

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
  }, [remoteEntries, activeRemoteKey, saveSession]);

  const handleAddRemoteProject = useCallback((entryId: string) => {
    setRemoteAddToEntryId(entryId);
    setRemoteDialogOpen(true);
  }, []);

  const handleRemoteDialogClose = useCallback(() => {
    setRemoteDialogOpen(false);
    setRemoteAddToEntryId(null);
  }, []);

  /** 从持久化的 saved_auth 恢复 remoteAuthStore */
  const restoreAuthFromEntries = useCallback((entries: RemoteEntrySession[]) => {
    const restored = new Map<string, AuthMethod>();
    for (const entry of entries) {
      if (entry.saved_auth) {
        try {
          const auth: AuthMethod = JSON.parse(atob(entry.saved_auth));
          restored.set(entry.id, auth);
        } catch {
          // ignore invalid saved_auth
        }
      }
    }
    if (restored.size > 0) {
      setRemoteAuthStore(prev => {
        const merged = new Map(prev);
        for (const [k, v] of restored) merged.set(k, v);
        return merged;
      });
    }
  }, []);

  return {
    remoteEntries, setRemoteEntries,
    activeRemoteKey, setActiveRemoteKey,
    activeRemoteProject, setActiveRemoteProject,
    remoteOpenSessions, setRemoteOpenSessions,
    remoteDialogOpen, setRemoteDialogOpen,
    remoteAddToEntryId,
    remoteAuthStore, setRemoteAuthStore,
    pendingAuthEntry, setPendingAuthEntry,
    remoteEntriesRef, activeRemoteKeyRef, selectRemoteProjectRef,
    handleRemoteEntryAdd,
    handleCloseRemoteProject, handleRemoveRemoteProject, handleRemoveRemoteEntry,
    handleAddRemoteProject, handleRemoteDialogClose,
    restoreAuthFromEntries,
  };
}

import { useState, useRef, useCallback, useEffect } from "react";
import { remoteCacheKey, destroyRemoteCache } from "../components/terminal";
import type { RemoteEntrySession, RemoteProject, AuthMethod } from "../types";
import type { SaveSessionFn } from "./useWslProjects";

export type ActiveRemoteKey = { host: string; projectId: string } | null;

export function useRemoteProjects(saveSession: SaveSessionFn) {
  const [remoteEntries, setRemoteEntries] = useState<RemoteEntrySession[]>([]);
  const [activeRemoteKey, setActiveRemoteKey] = useState<ActiveRemoteKey>(null);
  const [activeRemoteProject, setActiveRemoteProject] = useState<{
    entry: RemoteEntrySession;
    project: RemoteProject;
  } | null>(null);
  const [remoteOpenSessions, setRemoteOpenSessions] = useState<Set<string>>(new Set());
  const [remoteSideTerminalOpen, setRemoteSideTerminalOpen] = useState<Set<string>>(new Set());
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [remoteAddToEntryId, setRemoteAddToEntryId] = useState<string | null>(null);
  const [remoteAuthStore, setRemoteAuthStore] = useState<Map<string, AuthMethod>>(new Map());
  const [pendingAuthEntry, setPendingAuthEntry] = useState<RemoteEntrySession | null>(null);

  const remoteEntriesRef = useRef<RemoteEntrySession[]>([]);
  const activeRemoteKeyRef = useRef<ActiveRemoteKey>(null);
  const selectRemoteProjectRef = useRef<(host: string, project: RemoteProject) => void>(() => {});
  const remoteSideOpenRef = useRef<Set<string>>(new Set());

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

  const handleRemoteEntryAdd = useCallback(async (entry: RemoteEntrySession, auth: AuthMethod | null) => {
    try {
      const existingIndex = remoteEntries.findIndex(e => e.id === entry.id);
      let newEntries: RemoteEntrySession[];
      if (existingIndex >= 0) {
        newEntries = [...remoteEntries];
        newEntries[existingIndex] = entry;
      } else {
        newEntries = [...remoteEntries, entry];
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
    destroyRemoteCache(remoteCacheKey(entryId, projectId));
    destroyRemoteCache(remoteCacheKey(entryId, projectId) + ":side");
    if (activeRemoteKey?.projectId === projectId) {
      setActiveRemoteKey(null);
      setActiveRemoteProject(null);
    }
    setRemoteOpenSessions(prev => { const n = new Set(prev); n.delete(projectId); return n; });
    setRemoteSideTerminalOpen(prev => { const n = new Set(prev); n.delete(projectId); return n; });
  }, [activeRemoteKey]);

  const handleRemoveRemoteProject = useCallback(async (entryId: string, projectId: string) => {
    destroyRemoteCache(remoteCacheKey(entryId, projectId));
    destroyRemoteCache(remoteCacheKey(entryId, projectId) + ":side");
    if (activeRemoteKey?.projectId === projectId) {
      setActiveRemoteKey(null);
      setActiveRemoteProject(null);
    }
    setRemoteOpenSessions(prev => { const n = new Set(prev); n.delete(projectId); return n; });
    setRemoteSideTerminalOpen(prev => { const n = new Set(prev); n.delete(projectId); return n; });
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
        destroyRemoteCache(remoteCacheKey(entryId, p.id));
        destroyRemoteCache(remoteCacheKey(entryId, p.id) + ":side");
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

  return {
    remoteEntries, setRemoteEntries,
    activeRemoteKey, setActiveRemoteKey,
    activeRemoteProject, setActiveRemoteProject,
    remoteOpenSessions, setRemoteOpenSessions,
    remoteSideTerminalOpen, setRemoteSideTerminalOpen,
    remoteDialogOpen, setRemoteDialogOpen,
    remoteAddToEntryId,
    remoteAuthStore, setRemoteAuthStore,
    pendingAuthEntry, setPendingAuthEntry,
    remoteEntriesRef, activeRemoteKeyRef, selectRemoteProjectRef, remoteSideOpenRef,
    handleRemoteEntryAdd,
    handleCloseRemoteProject, handleRemoveRemoteProject, handleRemoveRemoteEntry,
    handleAddRemoteProject, handleRemoteDialogClose,
  };
}

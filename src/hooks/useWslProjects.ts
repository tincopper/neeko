import { useState, useRef, useCallback } from "react";
import { wslCacheKey, destroyWslCache } from "../components/terminal";
import type { WSLEntrySession, RemoteEntrySession, WSLProject } from "../types";

export type ActiveWslKey = { distro: string; projectId: string } | null;
export type SaveSessionFn = (wslEntries?: WSLEntrySession[], remoteEntries?: RemoteEntrySession[]) => Promise<void>;

export function useWslProjects(saveSession: SaveSessionFn) {
  const [wslEntries, setWslEntries] = useState<WSLEntrySession[]>([]);
  const [activeWslKey, setActiveWslKey] = useState<ActiveWslKey>(null);
  const [activeWslProject, setActiveWslProject] = useState<{ distro: string; project: WSLProject } | null>(null);
  const [wslOpenSessions, setWslOpenSessions] = useState<Set<string>>(new Set());
  const [wslDialogOpen, setWslDialogOpen] = useState(false);
  const [wslAddToEntryId, setWslAddToEntryId] = useState<string | null>(null);

  const wslEntriesRef = useRef<WSLEntrySession[]>([]);
  const activeWslKeyRef = useRef<ActiveWslKey>(null);
  const selectWslProjectRef = useRef<(distro: string, project: WSLProject) => void>(() => {});

  const handleWSLEntryAdd = useCallback(async (entry: WSLEntrySession) => {
    try {
      const existingIndex = wslEntries.findIndex(e => e.id === entry.id);
      let newEntries: WSLEntrySession[];
      if (existingIndex >= 0) {
        newEntries = [...wslEntries];
        newEntries[existingIndex] = entry;
      } else {
        newEntries = [...wslEntries, entry];
      }
      setWslEntries(newEntries);
      await saveSession(newEntries);
    } catch (error) {
      console.error("[App] Failed to save WSL entry:", error);
    }
  }, [wslEntries, saveSession]);

  const handleCloseWslProject = useCallback((entryId: string, projectId: string) => {
    const entry = wslEntries.find(e => e.id === entryId);
    if (entry) {
      destroyWslCache(wslCacheKey(entry.distro, projectId));
    }
    if (activeWslKey?.projectId === projectId) {
      setActiveWslKey(null);
      setActiveWslProject(null);
    }
    setWslOpenSessions(prev => { const n = new Set(prev); n.delete(projectId); return n; });
  }, [wslEntries, activeWslKey]);

  const handleRemoveWslProject = useCallback(async (entryId: string, projectId: string) => {
    const entry = wslEntries.find(e => e.id === entryId);
    if (entry) {
      destroyWslCache(wslCacheKey(entry.distro, projectId));
    }
    if (activeWslKey?.projectId === projectId) {
      setActiveWslKey(null);
      setActiveWslProject(null);
    }
    setWslOpenSessions(prev => { const n = new Set(prev); n.delete(projectId); return n; });
    const newEntries = wslEntries.map(e => {
      if (e.id !== entryId) return e;
      return { ...e, projects: e.projects.filter(p => p.id !== projectId) };
    });
    setWslEntries(newEntries);
    await saveSession(newEntries).catch(console.error);
  }, [wslEntries, activeWslKey, saveSession]);

  const handleRemoveWslEntry = useCallback(async (entryId: string) => {
    const entry = wslEntries.find(e => e.id === entryId);
    if (entry) {
      entry.projects.forEach(p => {
        const key = wslCacheKey(entry.distro, p.id);
        destroyWslCache(key);
        setWslOpenSessions(prev => { const next = new Set(prev); next.delete(p.id); return next; });
      });
      if (activeWslKey && entry.projects.some(p => p.id === activeWslKey.projectId)) {
        setActiveWslKey(null);
        setActiveWslProject(null);
      }
    }
    const newEntries = wslEntries.filter(e => e.id !== entryId);
    setWslEntries(newEntries);
    await saveSession(newEntries).catch(console.error);
  }, [wslEntries, activeWslKey, saveSession]);

  const handleAddWslProject = useCallback((entryId: string) => {
    setWslAddToEntryId(entryId);
    setWslDialogOpen(true);
  }, []);

  const handleWslDialogClose = useCallback(() => {
    setWslDialogOpen(false);
    setWslAddToEntryId(null);
  }, []);

  return {
    wslEntries, setWslEntries,
    activeWslKey, setActiveWslKey,
    activeWslProject, setActiveWslProject,
    wslOpenSessions, setWslOpenSessions,
    wslDialogOpen, setWslDialogOpen,
    wslAddToEntryId,
    wslEntriesRef, activeWslKeyRef, selectWslProjectRef,
    handleWSLEntryAdd,
    handleCloseWslProject, handleRemoveWslProject, handleRemoveWslEntry,
    handleAddWslProject, handleWslDialogClose,
  };
}

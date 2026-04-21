import { useState, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { wslCacheKey, destroyWslCachesByPrefix } from "../components/terminal";
import type { WSLEntrySession, RemoteEntrySession, WSLProject } from "../types";
import type { ActiveWslKey } from "../components/connections/types";
import { useAppStore } from "../store/appStore";
import { applyStateAction, upsertEntryById } from "../utils/entryUpdates";

export type { ActiveWslKey };
export type SaveSessionFn = (wslEntries?: WSLEntrySession[], remoteEntries?: RemoteEntrySession[]) => Promise<void>;

export function useWslProjects(saveSession: SaveSessionFn) {
  const wslEntries = useAppStore((state) => state.wslEntries);
  const activeWslKey = useAppStore((state) => state.activeWslKey);
  const activeWslProject = useAppStore((state) => state.activeWslProject);

  const setWslEntries: Dispatch<SetStateAction<WSLEntrySession[]>> = useCallback((updater) => {
    useAppStore.setState((state) => ({
      wslEntries: applyStateAction(state.wslEntries, updater),
    }));
  }, []);

  const setActiveWslKey: Dispatch<SetStateAction<ActiveWslKey>> = useCallback((updater) => {
    useAppStore.setState((state) => ({
      activeWslKey: applyStateAction(state.activeWslKey, updater),
    }));
  }, []);

  const setActiveWslProject: Dispatch<SetStateAction<{ distro: string; project: WSLProject } | null>> = useCallback((updater) => {
    useAppStore.setState((state) => ({
      activeWslProject: applyStateAction(state.activeWslProject, updater),
    }));
  }, []);

  const [wslOpenSessions, setWslOpenSessions] = useState<Set<string>>(new Set());
  const [wslDialogOpen, setWslDialogOpen] = useState(false);
  const [wslAddToEntryId, setWslAddToEntryId] = useState<string | null>(null);

  const handleWSLEntryAdd = useCallback(async (entry: WSLEntrySession) => {
    try {
      const newEntries = upsertEntryById(wslEntries, entry);
      setWslEntries(newEntries);
      await saveSession(newEntries);
    } catch (error) {
      console.error("[App] Failed to save WSL entry:", error);
    }
  }, [wslEntries, setWslEntries, saveSession]);

  const handleCloseWslProject = useCallback((entryId: string, projectId: string) => {
    const entry = wslEntries.find(e => e.id === entryId);
    if (entry) {
      destroyWslCachesByPrefix(wslCacheKey(entry.distro, projectId));
    }
    if (activeWslKey?.projectId === projectId) {
      setActiveWslKey(null);
      setActiveWslProject(null);
    }
    setWslOpenSessions(prev => { const n = new Set(prev); n.delete(projectId); return n; });
  }, [wslEntries, activeWslKey, setActiveWslKey, setActiveWslProject]);

  const handleRemoveWslProject = useCallback(async (entryId: string, projectId: string) => {
    const entry = wslEntries.find(e => e.id === entryId);
    if (entry) {
      destroyWslCachesByPrefix(wslCacheKey(entry.distro, projectId));
    }
    if (activeWslKey?.projectId === projectId) {
      setActiveWslKey(null);
      setActiveWslProject(null);
    }
    setWslOpenSessions(prev => { const n = new Set(prev); n.delete(projectId); return n; });
    const newEntries = wslEntries.map((entryItem) => {
      if (entryItem.id !== entryId) {
        return entryItem;
      }
      return {
        ...entryItem,
        projects: entryItem.projects.filter((project) => project.id !== projectId),
      };
    });
    setWslEntries(newEntries);
    await saveSession(newEntries).catch(console.error);
  }, [wslEntries, activeWslKey, setActiveWslKey, setActiveWslProject, setWslEntries, saveSession]);

  const handleRemoveWslEntry = useCallback(async (entryId: string) => {
    const entry = wslEntries.find(e => e.id === entryId);
    if (entry) {
      entry.projects.forEach(p => {
        const key = wslCacheKey(entry.distro, p.id);
        destroyWslCachesByPrefix(key);
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
  }, [wslEntries, activeWslKey, setActiveWslKey, setActiveWslProject, setWslEntries, saveSession]);

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
    handleWSLEntryAdd,
    handleCloseWslProject, handleRemoveWslProject, handleRemoveWslEntry,
    handleAddWslProject, handleWslDialogClose,
  };
}

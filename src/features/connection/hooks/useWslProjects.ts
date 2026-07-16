import { useState, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { wslCacheKey, destroyWslCachesByPrefix } from "@/features/terminal/components/terminalCache";
import type { WSLEntrySession, RemoteEntrySession } from '@/shared/types';
import { useProjectStore } from "@/features/project/store";
import { useConnectionStore } from "../store";
import { applyStateAction, upsertEntryById } from '@/shared/utils/entryUpdates';

export type SaveSessionFn = (wslEntries?: WSLEntrySession[], remoteEntries?: RemoteEntrySession[]) => Promise<void>;

export function useWslProjects(saveSession: SaveSessionFn) {
  const wslEntries = useConnectionStore((state) => state.wslEntries);

  const setWslEntries: Dispatch<SetStateAction<WSLEntrySession[]>> = useCallback((updater) => {
    useConnectionStore.setState((state) => ({
      wslEntries: applyStateAction(state.wslEntries, updater),
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
    const activeId = useProjectStore.getState().activeProjectId;
    if (activeId === projectId) {
      useProjectStore.setState({ activeProjectId: null, activeProject: null });
    }
    setWslOpenSessions(prev => { const n = new Set(prev); n.delete(projectId); return n; });
  }, [wslEntries]);

  const handleRemoveWslProject = useCallback(async (entryId: string, projectId: string) => {
    const entry = wslEntries.find(e => e.id === entryId);
    if (entry) {
      destroyWslCachesByPrefix(wslCacheKey(entry.distro, projectId));
    }
    const activeId = useProjectStore.getState().activeProjectId;
    if (activeId === projectId) {
      useProjectStore.setState({ activeProjectId: null, activeProject: null });
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
  }, [wslEntries, setWslEntries, saveSession]);

  const handleRemoveWslEntry = useCallback(async (entryId: string) => {
    const entry = wslEntries.find(e => e.id === entryId);
    if (entry) {
      entry.projects.forEach(p => {
        const key = wslCacheKey(entry.distro, p.id);
        destroyWslCachesByPrefix(key);
        setWslOpenSessions(prev => { const next = new Set(prev); next.delete(p.id); return next; });
      });
      const activeId = useProjectStore.getState().activeProjectId;
      if (activeId && entry.projects.some(p => p.id === activeId)) {
        useProjectStore.setState({ activeProjectId: null, activeProject: null });
      }
    }
    const newEntries = wslEntries.filter(e => e.id !== entryId);
    setWslEntries(newEntries);
    await saveSession(newEntries).catch(console.error);
  }, [wslEntries, setWslEntries, saveSession]);

  const handleAddWslProject = useCallback((entryId: string) => {
    setWslAddToEntryId(entryId);
    setWslDialogOpen(true);
  }, []);

  const handleWslDialogClose = useCallback(() => {
    setWslDialogOpen(false);
    setWslAddToEntryId(null);
  }, []);

  const handleWslDragEnd = useCallback((entryId: string, draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;

    setWslEntries((prev) => {
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
      saveSession(newEntries).catch((e) =>
        console.error("[WSL] Failed to persist project order:", e)
      );

      return newEntries;
    });
  }, [saveSession]);

  return {
    wslEntries, setWslEntries,
    wslOpenSessions, setWslOpenSessions,
    wslDialogOpen, setWslDialogOpen,
    wslAddToEntryId,
    handleWSLEntryAdd,
    handleCloseWslProject, handleRemoveWslProject, handleRemoveWslEntry,
    handleAddWslProject, handleWslDialogClose,
    handleWslDragEnd,
  };
}

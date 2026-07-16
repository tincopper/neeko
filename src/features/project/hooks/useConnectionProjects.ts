import { useState, useCallback, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  wslCacheKey,
  destroyWslCachesByPrefix,
  remoteCacheKey,
  destroyRemoteCachesByPrefix,
} from "@/features/terminal/components/terminalCache";
import type {
  AuthMethod,
  RemoteEntrySession,
  WSLEntrySession,
} from "@/shared/types";
import { useProjectStore } from "@/features/project/store";
import { useConnectionStore } from "@/features/connection/store";
import { useShallow } from "zustand/shallow";
import { applyStateAction, upsertEntryById } from "@/shared/utils/entryUpdates";

export type SaveSessionFn = (...args: unknown[]) => Promise<void>;
export type ProjectEnvironment = "wsl" | "remote";

interface UseConnectionProjectsParams {
  environment: ProjectEnvironment;
  saveSession: SaveSessionFn;
  showToast?: (message: string, type?: "info" | "error") => void;
}

/**
 * 统一项目 CRUD hook —— 替代 useWslProjects / useRemoteProjects。
 *
 * 通过 `environment` 参数分派 WSL 或 Remote 的内部实现。
 * WSL 环境不返回 auth 相关字段。
 */
export function useConnectionProjects({
  environment,
  saveSession,
  showToast,
}: UseConnectionProjectsParams) {
  const isWsl = environment === "wsl";

  // ── Store selectors ──────────────────────────────────────────────────────
  const wslEntries = useConnectionStore((state) => state.wslEntries);
  const remoteEntries = useConnectionStore(useShallow((state) => state.remoteEntries));
  const remoteAuthStore = useConnectionStore((state) => state.remoteAuthStore);
  const pendingAuthEntry = useConnectionStore((state) => state.pendingAuthEntry);

  const entries: (WSLEntrySession | RemoteEntrySession)[] = isWsl
    ? wslEntries
    : remoteEntries;

  // ── Store setters ────────────────────────────────────────────────────────

  const setEntries: Dispatch<SetStateAction<any[]>> = useCallback(
    (updater) => {
      const key = isWsl ? "wslEntries" as const : "remoteEntries" as const;
      useConnectionStore.setState((state) => ({
        [key]: applyStateAction(isWsl ? state.wslEntries : state.remoteEntries, updater),
      }));
    },
    [isWsl],
  );

  const setRemoteAuthStore: Dispatch<SetStateAction<Map<string, AuthMethod>>> = useCallback(
    (updater) => {
      useConnectionStore.setState((state) => ({
        remoteAuthStore: applyStateAction(state.remoteAuthStore, updater),
      }));
    },
    [],
  );

  const setPendingAuthEntry: Dispatch<SetStateAction<RemoteEntrySession | null>> = useCallback(
    (updater) => {
      useConnectionStore.setState((state) => ({
        pendingAuthEntry: applyStateAction(state.pendingAuthEntry, updater),
      }));
    },
    [],
  );

  // ── Local state ──────────────────────────────────────────────────────────

  const [openSessions, setOpenSessions] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [addToEntryId, setAddToEntryId] = useState<string | null>(null);

  // ── Remote: auth detection effect ────────────────────────────────────────

  useEffect(() => {
    if (isWsl) return;
    const activeProject = useProjectStore.getState().activeProject;
    if (!activeProject) {
      setPendingAuthEntry(null);
      return;
    }
    const env = activeProject.environment;
    if (env.type !== "Remote") {
      setPendingAuthEntry(null);
      return;
    }
    const entry = (remoteEntries as RemoteEntrySession[]).find(
      (e) => e.host === (env as any).host,
    );
    if (!entry) {
      setPendingAuthEntry(null);
      return;
    }
    if (!remoteAuthStore.has(entry.id)) {
      setPendingAuthEntry(entry);
    } else {
      setPendingAuthEntry(null);
    }
  }, [isWsl, remoteEntries, remoteAuthStore, setPendingAuthEntry]);

  // ── Entry add ────────────────────────────────────────────────────────────

  const handleEntryAdd = useCallback(
    async (
      entry: WSLEntrySession | RemoteEntrySession,
      auth?: AuthMethod | null,
      saved_auth?: string | null,
    ) => {
      try {
        const persistEntry = saved_auth ? { ...entry, saved_auth } : entry;
        const newEntries = upsertEntryById(entries, persistEntry);
        setEntries(newEntries);
        if (isWsl) {
          await saveSession(newEntries);
        } else {
          await saveSession(undefined, newEntries);
          if (auth) {
            setRemoteAuthStore((prev) => new Map(prev).set(entry.id, auth));
          }
        }
      } catch (error) {
        console.error(`[App] Failed to save ${isWsl ? "WSL" : "remote"} entry:`, error);
      }
    },
    [isWsl, entries, setEntries, saveSession, setRemoteAuthStore],
  );

  // ── Close project ────────────────────────────────────────────────────────

  const handleCloseProject = useCallback(
    (entryId: string, projectId: string) => {
      if (isWsl) {
        const entry = wslEntries.find((e) => e.id === entryId);
        if (entry) {
          destroyWslCachesByPrefix(wslCacheKey(entry.distro, projectId));
        }
      } else {
        destroyRemoteCachesByPrefix(remoteCacheKey(entryId, projectId));
      }
      const activeId = useProjectStore.getState().activeProjectId;
      if (activeId === projectId) {
        useProjectStore.setState({ activeProjectId: null, activeProject: null });
      }
      setOpenSessions((prev) => {
        const n = new Set(prev);
        n.delete(projectId);
        return n;
      });
    },
    [isWsl, wslEntries],
  );

  // ── Remove project ───────────────────────────────────────────────────────

  const handleRemoveProject = useCallback(
    async (entryId: string, projectId: string) => {
      if (isWsl) {
        const entry = wslEntries.find((e) => e.id === entryId);
        if (entry) {
          destroyWslCachesByPrefix(wslCacheKey(entry.distro, projectId));
        }
      } else {
        destroyRemoteCachesByPrefix(remoteCacheKey(entryId, projectId));
      }
      const activeId = useProjectStore.getState().activeProjectId;
      if (activeId === projectId) {
        useProjectStore.setState({ activeProjectId: null, activeProject: null });
      }
      setOpenSessions((prev) => {
        const n = new Set(prev);
        n.delete(projectId);
        return n;
      });

      const newEntries = (entries as any[]).map((entryItem: any) => {
        if (entryItem.id !== entryId) return entryItem;
        return {
          ...entryItem,
          projects: entryItem.projects.filter((p: any) => p.id !== projectId),
        };
      });
      setEntries(newEntries);
      if (isWsl) {
        await saveSession(newEntries).catch(console.error);
      } else {
        await saveSession(undefined, newEntries).catch(console.error);
      }
    },
    [isWsl, entries, wslEntries, setEntries, saveSession],
  );

  // ── Remove entry ─────────────────────────────────────────────────────────

  const handleRemoveEntry = useCallback(
    async (entryId: string) => {
      const entry = (entries as any[]).find((e: any) => e.id === entryId);
      if (entry) {
        if (isWsl) {
          entry.projects.forEach((p: any) => {
            const key = wslCacheKey(entry.distro, p.id);
            destroyWslCachesByPrefix(key);
            setOpenSessions((prev) => {
              const next = new Set(prev);
              next.delete(p.id);
              return next;
            });
          });
        } else {
          entry.projects.forEach((p: any) => {
            destroyRemoteCachesByPrefix(remoteCacheKey(entryId, p.id));
          });
          setRemoteAuthStore((prev) => {
            const next = new Map(prev);
            next.delete(entryId);
            return next;
          });
        }
        const activeId = useProjectStore.getState().activeProjectId;
        if (activeId && entry.projects.some((p: any) => p.id === activeId)) {
          useProjectStore.setState({ activeProjectId: null, activeProject: null });
        }
      }
      const newEntries = (entries as any[]).filter((e: any) => e.id !== entryId);
      setEntries(newEntries);
      if (isWsl) {
        await saveSession(newEntries).catch(console.error);
      } else {
        await saveSession(undefined, newEntries).catch(console.error);
      }
    },
    [isWsl, entries, setEntries, setRemoteAuthStore, saveSession],
  );

  // ── Add project (opening dialog) ─────────────────────────────────────────

  const handleAddProject = useCallback((entryId: string) => {
    setAddToEntryId(entryId);
    setDialogOpen(true);
  }, []);

  const handleDialogClose = useCallback(() => {
    setDialogOpen(false);
    setAddToEntryId(null);
  }, []);

  // ── Drag end ─────────────────────────────────────────────────────────────

  const handleDragEnd = useCallback(
    (entryId: string, draggedId: string, targetId: string) => {
      if (draggedId === targetId) return;

      setEntries((prev: any) => {
        const newEntries = prev.map((entry: any) => {
          if (entry.id !== entryId) return entry;

          const projects = [...entry.projects];
          const draggedIndex = projects.findIndex((p: any) => p.id === draggedId);
          const targetIndex = projects.findIndex((p: any) => p.id === targetId);

          if (draggedIndex < 0 || targetIndex < 0) return entry;

          const [dragged] = projects.splice(draggedIndex, 1);
          projects.splice(targetIndex, 0, dragged);

          return { ...entry, projects };
        });

        // Persist the new order
        if (isWsl) {
          saveSession(newEntries).catch((e: any) =>
            console.error(`[WSL] Failed to persist project order:`, e),
          );
        } else {
          saveSession(undefined, newEntries).catch((e: any) =>
            console.error(`[Remote] Failed to persist project order:`, e),
          );
        }

        return newEntries;
      });
    },
    [isWsl, saveSession, setEntries],
  );

  // ── Remote-specific: restoreAuthFromEntries ──────────────────────────────

  const restoreAuthFromEntries = useCallback(
    (restoreEntries: RemoteEntrySession[]) => {
      if (isWsl) return;
      const restored = new Map<string, AuthMethod>();
      for (const entry of restoreEntries) {
        if (entry.saved_auth) {
          try {
            const auth: AuthMethod = JSON.parse(atob(entry.saved_auth));
            restored.set(entry.id, auth);
          } catch (e) {
            console.warn(
              `[Remote] Failed to parse saved_auth for entry ${entry.id}:`,
              e,
            );
            showToast?.(
              `Failed to restore credentials for ${entry.host}:${entry.port}. Please re-enter.`,
              "error",
            );
          }
        }
      }
      if (restored.size > 0) {
        useConnectionStore.setState((state) => {
          const merged = new Map(state.remoteAuthStore);
          for (const [k, v] of restored) merged.set(k, v);
          return { remoteAuthStore: merged };
        });
      }
    },
    [isWsl, showToast],
  );

  // ── Return ───────────────────────────────────────────────────────────────

  const result: any = {
    // Unified fields
    entries,
    setEntries,
    openSessions,
    setOpenSessions,
    dialogOpen,
    setDialogOpen,
    addToEntryId,

    // Unified handlers
    handleEntryAdd,
    handleCloseProject,
    handleRemoveProject,
    handleRemoveEntry,
    handleAddProject,
    handleDialogClose,
    handleDragEnd,
  };

  // Remote-only fields
  if (!isWsl) {
    result.remoteAuthStore = remoteAuthStore;
    result.setRemoteAuthStore = setRemoteAuthStore;
    result.pendingAuthEntry = pendingAuthEntry;
    result.setPendingAuthEntry = setPendingAuthEntry;
    result.restoreAuthFromEntries = restoreAuthFromEntries;
  }

  return result;
}

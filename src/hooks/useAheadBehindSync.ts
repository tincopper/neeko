import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AheadBehind, AuthMethod } from "../types";
import { useAppStore } from "../store/appStore";
import { aheadBehindKey } from "../utils/aheadBehindKey";

/**
 * useAheadBehindSync —— 当 active 项目（local / WSL / SSH）切换时，
 * 单次 invoke 对应的 ahead/behind 命令，把结果写入 `useAppStore.aheadBehind`。
 *
 * 复合 key：`${kind}:${entryId}:${projectId}`，详见 `utils/aheadBehindKey.ts`。
 */
export function useAheadBehindSync() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const activeWslProject = useAppStore((s) => s.activeWslProject);
  const activeRemoteProject = useAppStore((s) => s.activeRemoteProject);
  const remoteAuthStore = useAppStore((s) => s.remoteAuthStore);
  const setAheadBehind = useAppStore((s) => s.setAheadBehind);

  // ── Local ──
  useEffect(() => {
    if (!activeProjectId) return;
    const key = aheadBehindKey("local", activeProjectId, activeProjectId);
    let cancelled = false;
    invoke<AheadBehind>("get_ahead_behind_command", { projectId: activeProjectId })
      .then((info) => {
        if (cancelled) return;
        setAheadBehind(key, info);
      })
      .catch(() => {
        if (cancelled) return;
        setAheadBehind(key, null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, setAheadBehind]);

  // ── WSL ──
  useEffect(() => {
    if (!activeWslProject) return;
    const { distro, project } = activeWslProject;
    const key = aheadBehindKey("wsl", distro, project.id);
    let cancelled = false;
    invoke<AheadBehind>("wsl_get_ahead_behind", {
      distro,
      projectPath: project.path,
    })
      .then((info) => {
        if (cancelled) return;
        setAheadBehind(key, info);
      })
      .catch(() => {
        if (cancelled) return;
        setAheadBehind(key, null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeWslProject, setAheadBehind]);

  // ── Remote ──
  useEffect(() => {
    if (!activeRemoteProject) return;
    const { entry, project } = activeRemoteProject;
    const auth = remoteAuthStore.get(entry.id) as AuthMethod | undefined;
    if (!auth) return;
    const key = aheadBehindKey("remote", entry.id, project.id);
    let cancelled = false;
    invoke<AheadBehind>("remote_get_ahead_behind", {
      host: entry.host,
      port: entry.port,
      username: entry.username,
      auth,
      projectPath: project.path,
    })
      .then((info) => {
        if (cancelled) return;
        setAheadBehind(key, info);
      })
      .catch(() => {
        if (cancelled) return;
        setAheadBehind(key, null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeRemoteProject, remoteAuthStore, setAheadBehind]);
}

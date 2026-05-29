import { useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  wslCacheKey,
  wslRebuildCallbacks,
  wslTerminalCache,
  wslWrapperRefs,
} from "../components/terminalCache";
import { useAppContext } from '@/shared/contexts';
import { useEditorContext } from '@/features/editor/context';
import { useWslContext } from '@/features/connection/contexts/wsl-context';
import type { TerminalStrategy } from "./types";

export function useWslTerminalStrategy(paneId: string): TerminalStrategy | null {
  const { config } = useAppContext();
  const { activeTabId } = useEditorContext();
  const { activeWslProject, activeWslWorktreePath, setWslOpenSessions } = useWslContext();

  return useMemo(() => {
    if (!activeWslProject) return null;

    const distro = activeWslProject.distro;
    const projectId = activeWslProject.project.id;
    const projectPath = activeWslWorktreePath ?? activeWslProject.project.path ?? "";

    const cacheKeySuffix = activeWslWorktreePath
      ? `:wt:${btoa(activeWslWorktreePath).replace(/=/g, "")}`
      : "";

    const cacheKey = `${wslCacheKey(distro, projectId)}${activeTabId ? `:${activeTabId}` : ""}${cacheKeySuffix}:${paneId}`;

    return {
      kind: "wsl" as const,
      cacheKey,
      cache: wslTerminalCache as Map<string, import("./types").CacheEntry>,
      rebuildCallbacks: wslRebuildCallbacks,
      wrapperRefs: wslWrapperRefs,
      createSession: async (cols: number, rows: number) => {
        const session = await invoke<{ id: string }>("create_wsl_terminal_session", {
          distro,
          projectPath,
          cols,
          rows,
        });
        return session.id;
      },
      resizeCmd: "resize_terminal",
      agentDelayMs: 500,
      connectingMessage: `\x1b[33m[WSL] Connecting to ${distro}:${projectPath}...\x1b[0m\r\n`,
      fontSize: config.terminalFontSize,
      fontFamily: config.fontFamily ?? "",
      gpuAccel: config.terminalGpuAcceleration ?? false,
      onSessionReady: () => {
        setWslOpenSessions((prev) => new Set(prev).add(projectId));
      },
    } satisfies TerminalStrategy;
  }, [
    activeWslProject,
    activeWslWorktreePath,
    activeTabId,
    paneId,
    config.terminalFontSize,
    config.fontFamily,
    config.terminalGpuAcceleration,
    setWslOpenSessions,
  ]);
}

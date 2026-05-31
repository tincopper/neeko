import { useMemo } from "react";
import { createRemoteTerminalSession, resizeRemoteTerminal, closeRemoteTerminalSession } from "../api/terminalApi";
import {
  remoteCacheKey,
  remoteRebuildCallbacks,
  remoteTerminalCache,
  remoteWrapperRefs,
} from "../components/terminalCache";
import { useAppContext } from '@/shared/contexts';
import { useEditorContext } from '@/shared/contexts';
import type { AuthMethod } from '@/shared/types';
import type { TerminalStrategy } from "./types";

interface RemoteStrategyParams {
  entryId: string;
  projectId: string;
  projectPath: string;
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
  fontSize?: number;
  fontFamily?: string;
  onSessionReady?: (projectId: string) => void;
  paneId?: string;
  cacheKeySuffix?: string;
}

export function useRemoteTerminalStrategy(
  params: RemoteStrategyParams,
): TerminalStrategy {
  const { config } = useAppContext();
  const { activeTabId, tabs } = useEditorContext();

  const {
    entryId,
    projectId,
    projectPath,
    host,
    port,
    username,
    auth,
    fontSize = 14,
    fontFamily = "",
    onSessionReady,
    paneId = "p1",
    cacheKeySuffix = "",
  } = params;

  return useMemo(() => {
    const cacheKey = `${remoteCacheKey(entryId, projectId)}${activeTabId ? `:${activeTabId}` : ""}${cacheKeySuffix}:${paneId}`;

    return {
      kind: "remote" as const,
      cacheKey,
      cache: remoteTerminalCache as Map<string, import("./types").CacheEntry>,
      rebuildCallbacks: remoteRebuildCallbacks,
      wrapperRefs: remoteWrapperRefs,
      createSession: async (cols: number, rows: number) => {
        const session = await createRemoteTerminalSession(
          host,
          port,
          username,
          auth,
          projectPath,
          cols,
          rows,
        );
        return session.id;
      },
      resize: resizeRemoteTerminal,
      closeSession: closeRemoteTerminalSession,
      agentDelayMs: 800,
      connectingMessage: `\x1b[33m[SSH] Connecting to ${username}@${host}:${port}${projectPath}...\x1b[0m\r\n`,
      fontSize,
      fontFamily,
      gpuAccel: config.terminalGpuAcceleration ?? false,
      onSessionReady: onSessionReady ? () => onSessionReady(projectId) : undefined,
    } satisfies TerminalStrategy;
  }, [
    entryId,
    projectId,
    projectPath,
    host,
    port,
    username,
    auth,
    fontSize,
    fontFamily,
    onSessionReady,
    paneId,
    cacheKeySuffix,
    activeTabId,
    tabs,
    config.terminalGpuAcceleration,
  ]);
}

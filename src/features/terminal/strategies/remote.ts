import { useMemo } from 'react';

import { useAppContext, useEditorContext } from '@/shared/contexts';
import type { AuthMethod } from '@/shared/types';

import { createTerminalSession, closeTerminalSession, resizeTerminal } from '../api/terminalApi';
import {
  remoteCacheKey,
  remoteRebuildCallbacks,
  remoteTerminalCache,
  remoteWrapperRefs,
} from '../components/terminalCache';
import { setupTerminalLinks } from '../components/terminalLinks';

import { createTerminalStrategy } from './factory';
import type { TerminalStrategy } from './types';

/** @deprecated Use `TerminalView` with `environment` prop instead. */
export interface RemoteStrategyParams {
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

/**
 * Remote terminal strategy hook.
 *
 * Prefer using the unified `useTerminalStrategy` from `./index` instead; this
 * export is kept for backward compatibility.
 */
export function useRemoteTerminalStrategy(params: RemoteStrategyParams): TerminalStrategy {
  const { config, showToast } = useAppContext();
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
    fontFamily = '',
    onSessionReady,
    paneId = 'p1',
    cacheKeySuffix = '',
  } = params;

  return useMemo(() => {
    const cacheKey = `${remoteCacheKey(entryId, projectId)}${activeTabId ? `:${activeTabId}` : ''}${cacheKeySuffix}:${paneId}`;

    return createTerminalStrategy({
      kind: 'remote',
      cacheKey,
      cache: remoteTerminalCache as Map<string, import('./types').CacheEntry>,
      rebuildCallbacks: remoteRebuildCallbacks,
      wrapperRefs: remoteWrapperRefs,
      createSession: async (cols: number, rows: number) => {
        const session = await createTerminalSession(projectId, cols, rows);
        return session.id;
      },
      resize: resizeTerminal,
      closeSession: closeTerminalSession,
      agentDelayMs: 800,
      connectingMessage: `\x1b[33m[SSH] Connecting to ${username}@${host}:${port}${projectPath}...\x1b[0m\r\n`,
      fontSize,
      fontFamily,
      gpuAccel: config.terminalGpuAcceleration ?? false,
      onSessionReady: onSessionReady ? () => onSessionReady(projectId) : undefined,
      setupFileLinks: (term) => {
        if (projectPath) {
          setupTerminalLinks(term, { projectPath, tabKey: projectId, projectId, showToast });
        }
      },
    });
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

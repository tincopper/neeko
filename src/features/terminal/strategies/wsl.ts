import { useMemo } from 'react';

import { useWslContext } from '@/features/connection/contexts/WslContext';
import { useAppContext, useEditorContext } from '@/shared/contexts';
import type { FileTransportKind } from '@/shared/types';
import { buildWorktreeTabKey } from '@/shared/utils/tabKey';

import { createWslTerminalSession, resizeTerminal, closeTerminalSession } from '../api/terminalApi';
import {
  wslCacheKey,
  wslRebuildCallbacks,
  wslTerminalCache,
  wslWrapperRefs,
} from '../components/terminalCache';
import { setupTerminalLinks } from '../components/terminalLinks';

import type { TerminalStrategy } from './types';

export function useWslTerminalStrategy(paneId: string): TerminalStrategy | null {
  const { config, showToast } = useAppContext();
  const { activeTabId } = useEditorContext();
  const { activeWslProject, activeWslWorktreePath, setWslOpenSessions } = useWslContext();

  return useMemo(() => {
    if (!activeWslProject) return null;

    const distro = activeWslProject.distro;
    const projectId = activeWslProject.project.id;
    const projectPath = activeWslWorktreePath ?? activeWslProject.project.path ?? '';

    const cacheKeySuffix = activeWslWorktreePath
      ? `:wt:${btoa(activeWslWorktreePath).replace(/=/g, '')}`
      : '';

    const cacheKey = `${wslCacheKey(distro, projectId)}${activeTabId ? `:${activeTabId}` : ''}${cacheKeySuffix}:${paneId}`;

    return {
      kind: 'wsl' as const,
      cacheKey,
      cache: wslTerminalCache as Map<string, import('./types').CacheEntry>,
      rebuildCallbacks: wslRebuildCallbacks,
      wrapperRefs: wslWrapperRefs,
      createSession: async (cols: number, rows: number) => {
        const session = await createWslTerminalSession(distro, projectPath, cols, rows);
        return session.id;
      },
      resize: resizeTerminal,
      closeSession: closeTerminalSession,
      agentDelayMs: 500,
      connectingMessage: `\x1b[33m[WSL] Connecting to ${distro}:${projectPath}...\x1b[0m\r\n`,
      fontSize: config.terminalFontSize,
      fontFamily: config.fontFamily ?? '',
      gpuAccel: config.terminalGpuAcceleration ?? false,
      onSessionReady: () => {
        setWslOpenSessions((prev) => new Set(prev).add(projectId));
      },
      setupFileLinks: (term) => {
        if (projectPath) {
          const tabKey = activeWslWorktreePath
            ? buildWorktreeTabKey(projectId, activeWslWorktreePath)
            : projectId;
          const transport: FileTransportKind = { Wsl: { distro, project_path: projectPath } };
          setupTerminalLinks(term, { projectPath, tabKey, projectId, transport, showToast });
        }
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

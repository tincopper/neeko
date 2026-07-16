import { useMemo } from 'react';

import { useProjectStore } from '@/features/project/store';
import { useAppContext, useEditorContext } from '@/shared/contexts';
import { useWorktreeStore } from '@/features/project/worktreeStore';
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
  const activeProject = useProjectStore((state) => state.activeProject);
  const activeWorktreePath = useWorktreeStore((state) => state.activeWorktreePath);

  return useMemo(() => {
    if (!activeProject || activeProject.environment.type !== 'Wsl') return null;

    const env = activeProject.environment;
    const distro = env.distro;
    const projectId = activeProject.id;
    const projectPath = activeWorktreePath ?? activeProject.path ?? '';

    const cacheKeySuffix = activeWorktreePath
      ? `:wt:${btoa(activeWorktreePath).replace(/=/g, '')}`
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
      onSessionReady: () => {},
      setupFileLinks: (term) => {
        if (projectPath) {
          const tabKey = activeWorktreePath
            ? buildWorktreeTabKey(projectId, activeWorktreePath)
            : projectId;
          setupTerminalLinks(term, { projectPath, tabKey, projectId, showToast });
        }
      },
    } satisfies TerminalStrategy;
  }, [
    activeProject,
    activeWorktreePath,
    activeTabId,
    paneId,
    config.terminalFontSize,
    config.fontFamily,
    config.terminalGpuAcceleration,
  ]);
}

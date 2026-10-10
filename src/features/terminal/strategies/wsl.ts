import { useMemo } from 'react';

import { useAppContext, useEditorContext } from '@/shared/contexts';
import { useProjectStore } from '@/shared/store/projectStore';
import { useActiveCheckoutPath } from '@/shared/store/workspaceStore';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { createTerminalSession, resizeTerminal, closeTerminalSession } from '../api/terminalApi';
import {
  wslCacheKey,
  wslRebuildCallbacks,
  wslTerminalCache,
  wslWrapperRefs,
} from '../components/terminalCache';
import { setupTerminalLinks } from '../components/terminalLinks';

import { createTerminalStrategy } from './factory';
import type { TerminalStrategy } from './types';

/**
 * WSL terminal strategy hook.
 *
 * Prefer using the unified `useTerminalStrategy` from `./index` instead; this
 * export is kept for backward compatibility.
 */
export function useWslTerminalStrategy(paneId: string): TerminalStrategy | null {
  const { config, showToast } = useAppContext();
  const { activeTabId } = useEditorContext();
  const activeProject = useProjectStore((state) => state.activeProject);
  const activeCheckoutPath = useActiveCheckoutPath();

  return useMemo(() => {
    if (!activeProject || activeProject.environment.type !== 'Wsl') return null;

    const env = activeProject.environment;
    const distro = env.distro;
    const projectId = activeProject.id;
    const projectPath = activeCheckoutPath ?? activeProject.path ?? '';

    const cacheKeySuffix = activeCheckoutPath
      ? `:wt:${btoa(activeCheckoutPath).replace(/=/g, '')}`
      : '';

    const cacheKey = `${wslCacheKey(distro, projectId)}${activeTabId ? `:${activeTabId}` : ''}${cacheKeySuffix}:${paneId}`;

    return createTerminalStrategy({
      kind: 'wsl',
      cacheKey,
      cache: wslTerminalCache as Map<string, import('./types').CacheEntry>,
      rebuildCallbacks: wslRebuildCallbacks,
      wrapperRefs: wslWrapperRefs,
      createSession: async (cols: number, rows: number) => {
        const session = await createTerminalSession(projectId, cols, rows);
        return session.id;
      },
      resize: resizeTerminal,
      closeSession: closeTerminalSession,
      agentDelayMs: 500,
      fontSize: config.terminalFontSize,
      fontFamily: config.monoFontFamily ?? config.fontFamily ?? '',
      gpuAccel: config.terminalGpuAcceleration ?? false,
      onSessionReady: () => {},
      setupFileLinks: (term) => {
        if (projectPath) {
          const tabWorkspace = WorkspaceSession.of(projectId, activeCheckoutPath ?? null);
          const tabKey = tabWorkspace.key;
          setupTerminalLinks(term, { projectPath, tabKey, workspace: tabWorkspace, showToast });
        }
      },
    });
  }, [
    activeProject,
    activeCheckoutPath,
    activeTabId,
    paneId,
    showToast,
    config.terminalFontSize,
    config.monoFontFamily,
    config.fontFamily,
    config.terminalGpuAcceleration,
  ]);
}

import { useMemo } from 'react';

import { useAppContext, useEditorContext } from '@/shared/contexts';
import { useProjectStore } from '@/shared/store/projectStore';
import { useActiveCheckoutPath } from '@/shared/store/workspaceStore';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { createTerminalSession, resizeTerminal, closeTerminalSession } from '../api/terminalApi';
import {
  terminalCache,
  terminalRebuildCallbacks,
  terminalWrapperRefs,
  terminalCacheKey,
} from '../components/terminalCache';
import { setupTerminalLinks } from '../components/terminalLinks';

import { createTerminalStrategy } from './factory';

/**
 * Local terminal strategy hook.
 *
 * Prefer using the unified `useTerminalStrategy` from `./index` instead; this
 * export is kept for backward compatibility.
 */
export function useLocalTerminalStrategy(paneId: string, worktreePathOverride?: string) {
  const { config, showToast } = useAppContext();
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeCheckoutPath = useActiveCheckoutPath();
  const { activeTabId } = useEditorContext();

  return useMemo(() => {
    const projectId = activeProject?.id ?? null;
    if (!projectId) return null;

    const effWorktreePath = worktreePathOverride ?? activeCheckoutPath;
    const isWorktree = Boolean(effWorktreePath);
    const projectPath = effWorktreePath ?? activeProject?.path ?? null;
    const cacheKey = projectId
      ? isWorktree
        ? `${projectId}:wt:${effWorktreePath}:${activeTabId ?? 'default'}:${paneId}`
        : terminalCacheKey(projectId, activeTabId, paneId)
      : `local:none:${paneId}`;

    return createTerminalStrategy({
      kind: 'local',
      cacheKey,
      cache: terminalCache as unknown as Map<string, import('./types').CacheEntry>,
      rebuildCallbacks: terminalRebuildCallbacks,
      wrapperRefs: terminalWrapperRefs,
      createSession: async (
        cols: number,
        rows: number,
        payload?: { command?: string; configId?: string },
      ) => {
        const session = await createTerminalSession(
          projectId,
          cols,
          rows,
          config.shell || null,
          projectPath || null,
          payload?.command ?? null,
        );
        return session.id;
      },
      resize: resizeTerminal,
      closeSession: closeTerminalSession,
      agentDelayMs: 0,
      fontSize: config.terminalFontSize,
      fontFamily: config.monoFontFamily ?? config.fontFamily ?? '',
      gpuAccel: config.terminalGpuAcceleration ?? false,
      outputFilter: (bytes: Uint8Array): Uint8Array => {
        const arr: number[] = [];
        for (const b of bytes) if (b !== 0x7f) arr.push(b);
        return arr.length > 0 ? new Uint8Array(arr) : new Uint8Array(0);
      },
      setupFileLinks: (term) => {
        if (projectPath) {
          const tabWorkspace = WorkspaceSession.of(
            projectId,
            isWorktree ? (effWorktreePath ?? null) : null,
          );
          const tabKey = tabWorkspace.key;
          setupTerminalLinks(term, { projectPath, tabKey, workspace: tabWorkspace, showToast });
        }
      },
    });
  }, [
    activeProject,
    activeCheckoutPath,
    worktreePathOverride,
    paneId,
    activeTabId,
    showToast,
    config.terminalFontSize,
    config.monoFontFamily,
    config.fontFamily,
    config.terminalGpuAcceleration,
    config.shell,
  ]);
}

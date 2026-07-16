import { useMemo } from 'react';

import { useProjectStore } from '@/features/project/store';
import { useWorktreeStore } from '@/features/project/worktreeStore';
import { useAppContext, useEditorContext } from '@/shared/contexts';
import { buildWorktreeTabKey } from '@/shared/utils/tabKey';
import type { AuthMethod } from '@/shared/types';

import {
  createTerminalSession,
  resizeTerminal,
  closeTerminalSession,
} from '../api/terminalApi';
import {
  terminalCache,
  terminalRebuildCallbacks,
  terminalWrapperRefs,
  terminalCacheKey,
  wslCacheKey,
  wslRebuildCallbacks,
  wslTerminalCache,
  wslWrapperRefs,
  remoteCacheKey,
  remoteRebuildCallbacks,
  remoteTerminalCache,
  remoteWrapperRefs,
} from '../components/terminalCache';
import { setupTerminalLinks } from '../components/terminalLinks';

import { createTerminalStrategy } from './factory';
import type { TerminalStrategy } from './types';

// Backward-compatible individual exports
export { useLocalTerminalStrategy } from './local';
export { useWslTerminalStrategy } from './wsl';
export { useRemoteTerminalStrategy } from './remote';
export type { TerminalStrategy } from './types';

export interface UseTerminalStrategyOptions {
  paneId: string;
  /** Remote-specific configuration. Only required when environment is Remote. */
  remoteConfig?: {
    entryId: string;
    host: string;
    port: number;
    username: string;
    auth: AuthMethod;
    onSessionReady?: (projectId: string) => void;
    cacheKeySuffix?: string;
  };
  /** Optional worktree overrides (same as local-only TerminalView props) */
  worktreePathOverride?: string;
  worktreeBranchOverride?: string;
}

/**
 * Unified terminal strategy hook.
 *
 * Inspects `activeProject.environment` and returns the correct strategy
 * for Local / WSL / Remote environments.
 *
 * Usage:
 * ```ts
 * const strategy = useTerminalStrategy({ paneId: 'p1' });
 * ```
 */
export function useTerminalStrategy(options: UseTerminalStrategyOptions): TerminalStrategy | null {
  const { config, showToast } = useAppContext();
  const { activeTabId, tabs } = useEditorContext();
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeWorktreePath = useWorktreeStore((s) => s.activeWorktreePath);
  const activeWorktreeBranch = useWorktreeStore((s) => s.activeWorktreeBranch);

  return useMemo(() => {
    const env = activeProject?.environment;
    if (!env) return null;

    // ---- Local ----
    if (env.type === 'Local') {
      return buildLocalStrategy();
    }

    // ---- WSL ----
    if (env.type === 'Wsl') {
      return buildWslStrategy(env);
    }

    // ---- Remote ----
    if (env.type === 'Remote') {
      return buildRemoteStrategy(env);
    }

    return null;

    function buildLocalStrategy(): TerminalStrategy | null {
      const projectId = activeProject?.id ?? null;
      if (!projectId) return null;

      const { worktreePathOverride, worktreeBranchOverride } = options;
      const effWorktreePath = worktreePathOverride ?? activeWorktreePath;
      const effWorktreeBranch = worktreeBranchOverride ?? activeWorktreeBranch;
      const isWorktree = !!effWorktreePath;
      const projectPath = effWorktreePath ?? activeProject?.path ?? null;
      const baseName = activeProject?.name ?? null;
      const projectName =
        baseName && effWorktreeBranch ? `${baseName} [${effWorktreeBranch}]` : (baseName ?? null);

      const cacheKey = projectId
        ? isWorktree
          ? `${projectId}:wt:${effWorktreePath}:${activeTabId ?? 'default'}:${options.paneId}`
          : terminalCacheKey(projectId, activeTabId, options.paneId)
        : `local:none:${options.paneId}`;

      return createTerminalStrategy({
        kind: 'local',
        cacheKey,
        cache: terminalCache as unknown as Map<string, import('./types').CacheEntry>,
        rebuildCallbacks: terminalRebuildCallbacks,
        wrapperRefs: terminalWrapperRefs,
        createSession: async (cols, rows, payload) => {
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
        connectingMessage: `\x1b[33m[Terminal] Connecting to ${projectName ?? projectPath}...\x1b[0m\r\n`,
        fontSize: config.terminalFontSize,
        fontFamily: config.fontFamily ?? '',
        gpuAccel: config.terminalGpuAcceleration ?? false,
        outputFilter: (bytes: Uint8Array): Uint8Array => {
          const arr: number[] = [];
          for (const b of bytes) if (b !== 0x7f) arr.push(b);
          return arr.length > 0 ? new Uint8Array(arr) : new Uint8Array(0);
        },
        setupFileLinks: (term) => {
          if (projectPath) {
            const tabKey =
              isWorktree && effWorktreePath
                ? buildWorktreeTabKey(projectId, effWorktreePath)
                : projectId;
            setupTerminalLinks(term, { projectPath, tabKey, projectId, showToast });
          }
        },
      });
    }

    // ---- WSL ----
    function buildWslStrategy(env: { type: 'Wsl'; distro: string }): TerminalStrategy | null {
      const distro = env.distro;
      const projectId = activeProject!.id;
      const projectPath = activeWorktreePath ?? activeProject!.path ?? '';

      const cacheKeySuffix = activeWorktreePath
        ? `:wt:${btoa(activeWorktreePath).replace(/=/g, '')}`
        : '';

      const cacheKey = `${wslCacheKey(distro, projectId)}${activeTabId ? `:${activeTabId}` : ''}${cacheKeySuffix}:${options.paneId}`;

      return createTerminalStrategy({
        kind: 'wsl',
        cacheKey,
        cache: wslTerminalCache as Map<string, import('./types').CacheEntry>,
        rebuildCallbacks: wslRebuildCallbacks,
        wrapperRefs: wslWrapperRefs,
        createSession: async (cols, rows) => {
          const session = await createTerminalSession(projectId, cols, rows);
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
      });
    }

    // ---- Remote ----
    function buildRemoteStrategy(_env: { type: 'Remote'; host: string; port: number; username: string; auth: AuthMethod }): TerminalStrategy | null {
      if (!options.remoteConfig) return null;
      const { remoteConfig } = options;
      const projectId = activeProject!.id;
      const projectPath = activeProject!.path;

      const cacheKey = `${remoteCacheKey(remoteConfig.entryId, projectId)}${activeTabId ? `:${activeTabId}` : ''}${remoteConfig.cacheKeySuffix ?? ''}:${options.paneId}`;

      return createTerminalStrategy({
        kind: 'remote',
        cacheKey,
        cache: remoteTerminalCache as Map<string, import('./types').CacheEntry>,
        rebuildCallbacks: remoteRebuildCallbacks,
        wrapperRefs: remoteWrapperRefs,
        createSession: async (cols, rows) => {
          const session = await createTerminalSession(projectId, cols, rows);
          return session.id;
        },
        resize: resizeTerminal,
        closeSession: closeTerminalSession,
        agentDelayMs: 800,
        connectingMessage: `\x1b[33m[SSH] Connecting to ${remoteConfig.username}@${remoteConfig.host}:${remoteConfig.port}${projectPath}...\x1b[0m\r\n`,
        fontSize: config.terminalFontSize,
        fontFamily: config.fontFamily ?? '',
        gpuAccel: config.terminalGpuAcceleration ?? false,
        onSessionReady: remoteConfig.onSessionReady
          ? () => remoteConfig.onSessionReady!(projectId)
          : undefined,
        setupFileLinks: (term) => {
          if (projectPath) {
            setupTerminalLinks(term, { projectPath, tabKey: projectId, projectId, showToast });
          }
        },
      });
    }
  }, [
    activeProject,
    activeWorktreePath,
    activeWorktreeBranch,
    options.paneId,
    options.worktreePathOverride,
    options.worktreeBranchOverride,
    options.remoteConfig?.entryId,
    options.remoteConfig?.host,
    options.remoteConfig?.port,
    options.remoteConfig?.username,
    options.remoteConfig?.auth,
    options.remoteConfig?.onSessionReady,
    options.remoteConfig?.cacheKeySuffix,
    activeTabId,
    tabs,
    config.terminalFontSize,
    config.fontFamily,
    config.terminalGpuAcceleration,
    config.shell,
  ]);
}

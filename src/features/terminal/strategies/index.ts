import { useMemo } from 'react';

import { useAppContext, useEditorContext } from '@/shared/contexts';
import { useProjectStore } from '@/shared/store/projectStore';
import { useActiveWorkspaceSession } from '@/shared/store/workspaceStore';
import type { AuthMethod } from '@/shared/types';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import { workspaceRootOf } from '@/shared/utils/workspaceRef';

import { createTerminalSession, resizeTerminal, closeTerminalSession } from '../api/terminalApi';
import { terminalAddress } from '../components/terminalAddress';
import {
  terminalCache,
  terminalRebuildCallbacks,
  terminalWrapperRefs,
  wslRebuildCallbacks,
  wslTerminalCache,
  wslWrapperRefs,
  remoteRebuildCallbacks,
  remoteTerminalCache,
  remoteWrapperRefs,
} from '../components/terminalCache';
import { setupTerminalLinks } from '../components/terminalLinks';

import { createTerminalStrategy } from './factory';
import type { TerminalStrategy } from './types';

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
    onSessionReady?: (projectId: ProjectId) => void;
  };
}

/**
 * Unified terminal strategy hook.
 *
 * Inspects `activeProject.environment` and returns the correct strategy
 * for Local / WSL / Remote environments.
 *
 * **寻址**：cacheKey 一律由 `terminalAddress(session, tabId, paneId)` 派生，session 来源是
 * `useActiveWorkspaceSession`（唯一身份源）。env 不进键（Q6）——三环境键形态相同，
 * 物理 Map 由 backend 身份承担，读写同键。
 *
 * Usage:
 * ```ts
 * const strategy = useTerminalStrategy({ paneId: 'p1' });
 * ```
 */
export function useTerminalStrategy(options: UseTerminalStrategyOptions): TerminalStrategy | null {
  const { config, showToast } = useAppContext();
  const { activeTabId = null } = useEditorContext();
  const activeProject = useProjectStore((s) => s.activeProject);
  const session = useActiveWorkspaceSession(activeProject?.id ?? null);
  const { paneId, remoteConfig } = options;

  return useMemo(() => {
    if (!activeProject || !session) return null;
    const env = activeProject.environment;

    // 同一次渲染内 tabId 稳定；缺省占位与旧 WSL/worktree 分支口径一致（'default'）。
    const cacheKey = terminalAddress(session, activeTabId ?? 'default', paneId);

    // ---- Local ----
    if (env.type === 'Local') {
      // 文件链接的路径基准 = 该 Workspace 的工作树根（与终端运行根同源）。
      const projectPath = workspaceRootOf(session.key, activeProject.path ?? '');

      return createTerminalStrategy({
        kind: 'local',
        cacheKey,
        cache: terminalCache as unknown as Map<string, import('./types').CacheEntry>,
        rebuildCallbacks: terminalRebuildCallbacks,
        wrapperRefs: terminalWrapperRefs,
        createSession: async (cols, rows, payload) => {
          // 运行根由后端从 session 派生；交互终端不传 second run root。
          const created = await createTerminalSession(session, cols, rows, {
            shell: config.shell || null,
            command: payload?.command ?? null,
            agentId: payload?.agentId ?? null,
            resumeFrom: payload?.resumeFrom ?? null,
          });
          return created.id;
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
            setupTerminalLinks(term, {
              projectPath,
              tabKey: session.key,
              workspace: session,
              showToast,
            });
          }
        },
      });
    }

    // ---- WSL ----
    if (env.type === 'Wsl') {
      const projectPath = workspaceRootOf(session.key, activeProject.path ?? '');

      return createTerminalStrategy({
        kind: 'wsl',
        cacheKey,
        cache: wslTerminalCache as Map<string, import('./types').CacheEntry>,
        rebuildCallbacks: wslRebuildCallbacks,
        wrapperRefs: wslWrapperRefs,
        createSession: async (cols, rows, payload) => {
          // WSL/SSH 不转发 command（行为不变），但 agent 身份必须下发（图标/标题靠它）
          const created = await createTerminalSession(session, cols, rows, {
            agentId: payload?.agentId ?? null,
            resumeFrom: payload?.resumeFrom ?? null,
          });
          return created.id;
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
            setupTerminalLinks(term, {
              projectPath,
              tabKey: session.key,
              workspace: session,
              showToast,
            });
          }
        },
      });
    }

    // ---- Remote ----
    if (!remoteConfig) return null;
    const projectPath = workspaceRootOf(session.key, activeProject.path ?? '');

    return createTerminalStrategy({
      kind: 'remote',
      cacheKey,
      cache: remoteTerminalCache as Map<string, import('./types').CacheEntry>,
      rebuildCallbacks: remoteRebuildCallbacks,
      wrapperRefs: remoteWrapperRefs,
      createSession: async (cols, rows, payload) => {
        // 同 WSL：command 不转发（行为不变），agent 身份显式下发
        const created = await createTerminalSession(session, cols, rows, {
          agentId: payload?.agentId ?? null,
          resumeFrom: payload?.resumeFrom ?? null,
        });
        return created.id;
      },
      resize: resizeTerminal,
      closeSession: closeTerminalSession,
      agentDelayMs: 800,
      fontSize: config.terminalFontSize,
      fontFamily: config.monoFontFamily ?? config.fontFamily ?? '',
      gpuAccel: config.terminalGpuAcceleration ?? false,
      onSessionReady: remoteConfig.onSessionReady
        ? () => remoteConfig.onSessionReady!(activeProject.id)
        : undefined,
      setupFileLinks: (term) => {
        if (projectPath) {
          setupTerminalLinks(term, {
            projectPath,
            tabKey: session.key,
            workspace: session,
            showToast,
          });
        }
      },
    });
  }, [
    activeProject,
    session,
    paneId,
    remoteConfig,
    activeTabId,
    showToast,
    config.terminalFontSize,
    config.monoFontFamily,
    config.fontFamily,
    config.terminalGpuAcceleration,
    config.shell,
  ]);
}

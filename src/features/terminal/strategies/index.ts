import { useMemo } from 'react';

import { useAppContext, useEditorContext } from '@/shared/contexts';
import { useEditorStore } from '@/shared/store/editorStore';
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

/**
 * 接管一条既有后端会话的 tab 落在 wsl / remote 环境上时的**可读拒绝**。
 *
 * 为什么不静默新建：团队 PTY 只可能是本机会话（`start_team_session` 在 Local 环境起 PTY）。
 * 静默新建的结果是用户看到两个终端 —— 一个空的新 PTY，一个后端点着却不显示的队长 ——
 * 且没有任何线索指向真正的原因。拒绝时终端会显示这条理由（`TerminalViewBase` 的失败分支）。
 */
function takeoverUnsupported(kind: 'wsl' | 'remote', sessionId: string): Error {
  return new Error(
    `cannot attach to existing terminal session "${sessionId}" in a ${kind} terminal: ` +
      'a taken-over session is always a local PTY. Refusing instead of opening a second, empty terminal.',
  );
}

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

  // 接管信号（`TerminalTabData.existingSessionId`）：目标 tab 就是**本 pane 的前台 tab**，
  // 与 cacheKey 的 `activeTabId` 同源（缺省占位 'default' 不对应任何真实 tab ⇒ null）。
  // 只选标量：状态更新（Idle → Running）不应因对象身份变化而重建策略对象。
  const sessionKey = session?.key ?? null;
  const existingSessionId = useEditorStore((s) => {
    if (!sessionKey || !activeTabId) return null;
    const tab = s.tabs[sessionKey]?.tabs.find((t) => t.id === activeTabId);
    return tab?.data.kind === 'terminal' ? (tab.data.existingSessionId ?? null) : null;
  });

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
        // 所有权事实的唯一来源：接管来的会话不归本 entry 所有，
        // 关 tab / 自愈重建只销毁缓存，不下发 `close_terminal_session`。
        attachedSession: existingSessionId,
        createSession: async (cols, rows, payload) => {
          // 接管：会话已由后端建好（团队队长/成员 PTY 由 `start_team_session` 起），
          // **不发** `create_terminal_session` —— 新建只会得到第二个 PTY，而后端那个会话
          // 永远没有消费者（用户看到团队在跑，界面上却什么都没有）。
          //
          // 接管**不需要新的握手**：credit-pull 的缓冲按 session 存在后端
          //（`common/terminal/drain.rs::SessionDrain`，512KB 上限 + `terminal/pump.rs` 的
          // 背压语义：缓冲满时泵**暂停读**而不是丢字节，上游被内核 PTY 缓冲接住）。所以
          // 前端拿到 id 就能 drain，会话起来至今的输出会被拉到屏幕上，超量部分在接管后
          // 自然恢复；尺寸靠既有 fit → `resize_terminal` 同步。协议一行不改。
          if (existingSessionId) return existingSessionId;
          // 运行根由后端从 session 派生；交互终端不传 second run root。
          const created = await createTerminalSession(
            session,
            cols,
            rows,
            config.shell || null,
            null,
            payload?.command ?? null,
          );
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
        createSession: async (cols, rows) => {
          if (existingSessionId) throw takeoverUnsupported('wsl', existingSessionId);
          const created = await createTerminalSession(session, cols, rows);
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
      createSession: async (cols, rows) => {
        if (existingSessionId) throw takeoverUnsupported('remote', existingSessionId);
        const created = await createTerminalSession(session, cols, rows);
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
    existingSessionId,
    showToast,
    config.terminalFontSize,
    config.monoFontFamily,
    config.fontFamily,
    config.terminalGpuAcceleration,
    config.shell,
  ]);
}

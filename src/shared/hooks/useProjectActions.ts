import { useCallback, useMemo, useState } from 'react';

import { bumpGitRefresh } from '@/shared/hooks/useGitRefresh';
import { useConnectionStore } from '@/shared/store/connectionStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import {
  activeWorkspaceSession,
  selectActiveCheckoutPath,
  useActiveCheckoutPath,
  useWorkspaceStore,
} from '@/shared/store/workspaceStore';
import type { AgentConfig, AppConfig, RemoteEntrySession, Tab } from '@/shared/types';
import { updateProjectInEntries } from '@/shared/utils/entryUpdates';
import type { ProjectId } from '@/shared/utils/workspaceRef';

// eslint-disable-next-line import/no-restricted-paths -- shared hook depends on git API for git info refresh
import { getGitInfo } from '../../features/git/api/gitApi';
// eslint-disable-next-line import/no-restricted-paths -- shared hook depends on project API for onboarding check
import { loadOnboardingState } from '../../features/project/api/onboardingApi';
// eslint-disable-next-line import/no-restricted-paths -- shared hook depends on project API for IDE launch
import { openWslIde, openRemoteIde } from '../../features/project/api/projectApi';
// eslint-disable-next-line import/no-restricted-paths -- shared hook mirrors local worktree onboarding check
import {
  refreshWslTerminal,
  switchAgentInWslTerminal,
  wslCacheKey,
  refreshRemoteTerminal,
  remoteCacheKey,
  switchAgentInRemoteTerminal,
  // eslint-disable-next-line import/no-restricted-paths -- shared hook depends on terminal cache for terminal operations
} from '../../features/terminal/components/terminalCache';

import type { SaveSessionFn } from './useConnectionProjects';

export type ProjectEnvironment = 'wsl' | 'remote';
export interface WslDiffState {
  distro: string;
  projectPath: string;
  filePath: string;
}
interface UseProjectActionsParams {
  environment: ProjectEnvironment;
  config: AppConfig;
  showToast: (message: string, type?: 'info' | 'error') => void;
  saveSession: SaveSessionFn;
}
/**
 * 统一的项目 action hook —— 替代 useWslActions / useRemoteActions。
 *
 * 通过 `environment` 参数分派 WSL 或 Remote 的内部实现。
 * 工作树状态只有一份表示（`workspaceStore.byProject[projectId]`），本 hook 一律经
 * selector / 显式 mutator 读写它 —— 旧的 `activeWorktreePath` / `activeWorktreeBranch`
 * 全局镜像与 `worktreeStateMap` 都已删除（镜像会让跨项目刷新读到别的项目的单元）。
 */
export function useProjectActions({
  environment,
  config,
  showToast,
  saveSession,
}: UseProjectActionsParams) {
  const isWsl = environment === 'wsl';
  // ── Store selectors ──────────────────────────────────────────────────────
  const remoteEntries = useConnectionStore((state) => state.remoteEntries);
  const remoteAuthStore = useConnectionStore((state) => state.remoteAuthStore);
  const activeCheckoutPath = useActiveCheckoutPath();
  // ── Diff state (WSL-only) ────────────────────────────────────────────────
  const [wslDiffState, setWslDiffState] = useState<WslDiffState | null>(null);

  // ── Worktree operations（唯一表示：byProject[projectId]）──────────────────

  const openWorktreeTerminal = useCallback(
    (worktreePath: string, branch: string) => {
      // Mirror the local worktree behaviour: on the very first visit to a
      // worktree, show the onboarding guide instead of jumping straight into a
      // terminal.
      void (async () => {
        const pid = useProjectStore.getState().activeProjectId;
        if (!pid) return;
        const onboardingKey = `${pid}::${worktreePath}`;
        const onboardingState = await loadOnboardingState(onboardingKey);
        if (onboardingState === null) return;

        const worktrees = useWorkspaceStore.getState();
        worktrees.setActiveWorkspace(pid, worktreePath, branch);
        worktrees.markWorkspaceOpened(pid, worktreePath, branch);
        if (isWsl) {
          setWslDiffState(null);
        }
      })();
    },
    [isWsl, setWslDiffState],
  );

  const resetTransientState = useCallback(() => {
    const pid = useProjectStore.getState().activeProjectId;
    if (pid) useWorkspaceStore.getState().clearActiveWorkspace(pid);
    if (isWsl) {
      setWslDiffState(null);
    }
  }, [isWsl, setWslDiffState]);

  // ── Git refresh ─────────────────────────────────────────────────────────

  const refreshGit = useMemo(() => {
    const handler = async (_connectionId: string, projectId: ProjectId): Promise<void> => {
      // 单元归属按被刷新的 projectId 取（旧实现读全局镜像 → 跨项目刷新会串到别的工作树）
      const worktreePath = selectActiveCheckoutPath(useWorkspaceStore.getState(), projectId);
      const gitInfo = await getGitInfo(projectId, worktreePath).catch((e) => {
        console.error(`[${isWsl ? 'WSL' : 'SSH'}] Failed to refresh git info:`, e);
        return null;
      });
      if (!gitInfo) return;

      const storeKey = isWsl ? 'wslEntries' : 'remoteEntries';
      useConnectionStore.setState((state: any) => ({
        [storeKey]: updateProjectInEntries(state[storeKey], projectId, (project: any) => ({
          ...project,
          git_info: gitInfo,
        })),
      }));

      useProjectStore.setState((state) => {
        if (!state.activeProject || state.activeProject.id !== projectId) return state;
        return {
          activeProject: { ...state.activeProject, git_info: gitInfo },
          projects: state.projects.map((p) =>
            p.id === projectId ? { ...p, git_info: gitInfo } : p,
          ),
        };
      });
    };
    return handler;
  }, [isWsl]);

  const handleRefreshGit = useCallback(
    async (connectionId: string, projectId: ProjectId) => {
      // 通知 diff 等依赖 Git 状态的缓存失效
      bumpGitRefresh(projectId);
      await refreshGit(connectionId, projectId);
    },
    [refreshGit],
  );
  // ── File selection (WSL-only — Remote uses its own flow) ──────────────

  // 前两个参数（distro / projectPath）已由Workspace地址承载，保留形参以稳定调用签名
  const handleSelectFile = useCallback(
    (_distro: string, _projectPath: string, filePath: string) => {
      const activeProject = useProjectStore.getState().activeProject;
      if (!activeProject) return;

      const projectId = activeProject.id;
      const session = activeWorkspaceSession(projectId);
      const existingTabs = useEditorStore.getState().tabs[session.key];
      const existingDiffTab = existingTabs?.tabs.find(
        (t) => t.data.kind === 'diff' && t.data.filePath === filePath,
      );
      if (existingDiffTab) {
        useEditorStore.getState().activateTab(session.key, existingDiffTab.id);
        return;
      }

      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      const tabId = `tab_${crypto.randomUUID()}`;
      const tab: Tab = {
        id: tabId,
        scope: { kind: 'workspace', session },
        title: fileName,
        order: existingTabs?.tabs.length ?? 0,
        data: {
          kind: 'diff',
          filePath,
          fileName,
          diffSource: { workspace: session, revision: { type: 'worktree' } },
        },
      };
      useEditorStore.getState().addTab(tab);
      useEditorStore.getState().activateTab(session.key, tabId);
    },
    [],
  );
  // ── IDE operations ──────────────────────────────────────────────────────

  const handleOpenIde = useCallback(
    (connectionId: string, projectPath: string, ide: string) => {
      if (!ide) {
        showToast('No IDE selected for this project', 'error');
        return;
      }

      if (isWsl) {
        openWslIde(connectionId, projectPath, ide).catch((error) => {
          showToast(String(error), 'error');
        });
      } else {
        const entry = (remoteEntries as RemoteEntrySession[]).find(
          (item) => item.id === connectionId,
        );
        if (!entry) return;
        openRemoteIde(entry.host, entry.port, entry.username, projectPath, ide).catch((error) => {
          showToast(String(error), 'error');
        });
      }
    },
    [isWsl, remoteEntries, showToast],
  );

  const handleOpenWorktreeTerminal = useCallback(
    (_connectionId: string, worktreePath: string, branch: string) => {
      openWorktreeTerminal(worktreePath, branch);
    },
    [openWorktreeTerminal],
  );

  // ── Agent operations ────────────────────────────────────────────────────

  const updateProjectAgent = useCallback(
    (agent: AgentConfig | null) => {
      const activeProject = useProjectStore.getState().activeProject;
      if (!activeProject) return;

      const agentId = agent?.id ?? null;
      const storeKey = isWsl ? 'wslEntries' : 'remoteEntries';
      useConnectionStore.setState((state: any) => ({
        [storeKey]: updateProjectInEntries(state[storeKey], activeProject.id, (project: any) => ({
          ...project,
          selected_agents: agentId ? [agentId] : [],
        })),
      }));

      useProjectStore.setState((state) => {
        if (state.activeProject?.id !== activeProject.id) return state;
        return {
          activeProject: { ...state.activeProject, selected_agents: agentId ? [agentId] : [] },
        };
      });
      saveSession().catch(console.error);
    },
    [saveSession, isWsl],
  );

  const handleSelectAgent = useCallback(
    (agent: AgentConfig | null) => {
      const activeProject = useProjectStore.getState().activeProject;
      if (!activeProject) return;

      const envType = isWsl ? 'Wsl' : 'Remote';
      if (activeProject.environment.type !== envType) return;

      if (isWsl) {
        const env = activeProject.environment as any;
        const distro = env.distro;
        const cacheKey = wslCacheKey(distro, activeProject.id);
        if (agent) {
          void switchAgentInWslTerminal(
            cacheKey,
            distro,
            activeProject.path,
            activeProject.name,
            agent.id,
            config.terminalFontSize ?? 14,
            config.monoFontFamily ?? config.fontFamily ?? '',
            config.agentCommandOverrides,
          );
        }
        updateProjectAgent(agent);
        if (!agent) {
          setTimeout(() => refreshWslTerminal(cacheKey), 50);
        }
      } else {
        const env = activeProject.environment as any;
        const entryId = remoteEntries.find((e) => e.host === env.host)?.id ?? '';
        const cacheKey = remoteCacheKey(entryId, activeProject.id);
        if (agent) {
          void switchAgentInRemoteTerminal(cacheKey, agent.id, config.agentCommandOverrides);
        }
        updateProjectAgent(agent);
        if (!agent) {
          setTimeout(() => refreshRemoteTerminal(cacheKey), 50);
        }
      }
    },
    [isWsl, config, remoteEntries, updateProjectAgent],
  );

  // ── Remote-specific: invokeRemoteGit ────────────────────────────────────

  const invokeRemoteGit = useCallback(
    async (command: string, entryId: string, extra: Record<string, unknown>): Promise<unknown> => {
      if (isWsl) {
        throw new Error('invokeRemoteGit is only available for Remote projects');
      }
      const { invokeRemoteGitCommand } = await import(
        '../../features/connection/api/connectionApi' // eslint-disable-line import/no-restricted-paths
      );
      const entry = (remoteEntries as RemoteEntrySession[]).find((item) => item.id === entryId);
      const auth = remoteAuthStore.get(entryId);
      if (!entry || !auth) {
        throw new Error('No auth for entry');
      }
      return invokeRemoteGitCommand(command, entry.host, entry.port, entry.username, auth, extra);
    },
    [isWsl, remoteEntries, remoteAuthStore],
  );

  // ── Return ───────────────────────────────────────────────────────────────

  return {
    // Worktree state（读：当前激活项目的单元；写：按 projectId 落 byProject，无镜像）
    activeCheckoutPath,
    setActiveWorkspacePath: (path: string | null) => {
      const pid = useProjectStore.getState().activeProjectId;
      if (pid) useWorkspaceStore.getState().setActiveWorkspace(pid, path);
    },

    // Diff state (WSL-only)
    wslDiffState: isWsl ? wslDiffState : undefined,
    setWslDiffState: isWsl ? setWslDiffState : undefined,

    // Worktree operations
    resetTransientState,
    openWorktreeTerminal,

    // Git refresh
    refreshGit,
    handleRefreshGit,

    // File selection (WSL opens diff tab)
    handleSelectFile: isWsl ? handleSelectFile : undefined,

    // IDE
    handleOpenIde,

    // Worktree terminal
    handleOpenWorktreeTerminal,

    // Agent
    handleSelectAgent,
    updateProjectAgent,

    // Remote-specific
    invokeRemoteGit: isWsl ? undefined : invokeRemoteGit,
  };
}

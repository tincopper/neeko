import { useState, useEffect } from 'react';

import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { Worktree } from '@/shared/types';
import { reportFrontendError } from '@/shared/utils/errorReporting';
import { repoKeyOf } from '@/shared/utils/repoRef';

/* eslint-disable import/no-restricted-paths -- session bootstrap needs git API for reading git info */
import { canonicalWorktreePath, getGitBranchInfo, getRepoStatus } from '../../git/api/gitApi';
import { useGitPerfSuggestion } from '../../git/hooks/useGitPerfSuggestion';
import { useGitStatusEventsSync } from '../../git/hooks/useGitStatusEventsSync';
/* eslint-enable import/no-restricted-paths */
// eslint-disable-next-line import/no-restricted-paths -- session bootstrap needs project API for listing projects
import { listProjects } from '../../project/api/projectApi';
import { loadSession } from '../api/sessionApi';

/**
 * 初始化硬超时：任何 bootstrap 环节挂起（IPC 卡死、promise 永不 settle）时，
 * 超时强制退出 splash——应用骨架可用性优先于完整恢复。
 */
const BOOTSTRAP_HARD_TIMEOUT_MS = 10_000;

export function useSessionBootstrap(deps: {
  loadProjects: () => Promise<void>;
  restoreWorktreeState: (worktreeState: Record<string, string>) => void;
}) {
  const [initialSidebarWidth, setInitialSidebarWidth] = useState<number>(280);
  const [initializing, setInitializing] = useState(true);

  const { loadProjects, restoreWorktreeState } = deps;

  // git 状态事件流同步（git-changed 兜底刷新 + git-status-snapshot 版本化快照），
  // 监听注册与去抖调度在 useGitStatusEventsSync 内部自管理
  useGitStatusEventsSync();
  useGitPerfSuggestion();

  useEffect(() => {
    // 超时兜底：无论初始化链路结局如何，splash 必须退出
    const hardTimeout = setTimeout(() => setInitializing(false), BOOTSTRAP_HARD_TIMEOUT_MS);

    loadProjects().then(async () => {
      try {
        const projects = await listProjects();
        const defaultGitInfo = {
          current_branch: '',
          branches: [] as string[],
          worktrees: [] as Worktree[],
          git_provider: '',
        };

        const patchGitInfo = (projectId: string, patch: Partial<typeof defaultGitInfo>) => {
          useProjectStore.setState((state) => {
            const nextProjects = state.projects.map((proj) => {
              if (proj.id !== projectId) return proj;
              return { ...proj, git_info: { ...(proj.git_info ?? defaultGitInfo), ...patch } };
            });
            return {
              projects: nextProjects,
              activeProject:
                state.activeProjectId === projectId
                  ? (nextProjects.find((proj) => proj.id === projectId) ?? state.activeProject)
                  : state.activeProject,
            };
          });
        };

        for (const p of projects) {
          // 非 git 项目（git_info 为 null）跳过所有 git 命令
          if (p.git_info === null) continue;
          const mainKey = repoKeyOf(p.id, null);
          // 主仓单元 status：走同一写入口（applyStatus 内含 version gate），侧栏
          // 变更计数因此有数据来源；激活单元由 useActiveRepoUnitSync 负责挂载与刷新。
          if (!useProjectStore.getState().statuses[mainKey]) {
            getRepoStatus(p.id, null)
              .then((snapshot) => {
                if (snapshot.repo_key !== mainKey) return;
                useProjectStore.getState().applyStatus(snapshot);
              })
              .catch((err) => reportFrontendError('session.gitStatus', err));
          }

          getGitBranchInfo(p.id)
            .then((branchInfo) => {
              // 只写 per-project 元数据；current_branch 的唯一写者是 applyStatus
              // （主仓单元投影），bootstrap 不再各自覆盖它。
              patchGitInfo(p.id, {
                branches: branchInfo.branches,
                worktrees: branchInfo.worktrees,
              });
            })
            .catch((err) => reportFrontendError('session.gitBranchInfo', err));
        }
      } catch {
        // Ignore — best-effort branch metadata fetch
      }
    });

    loadSession()
      .then((session) => {
        if (session.sidebar_width) {
          setInitialSidebarWidth(session.sidebar_width);
        }
        const wtState = session.worktree_state;
        if (wtState && typeof wtState === 'object') {
          restoreWorktreeState(wtState);
        }

        // 恢复上次活动的项目（来自 session 持久化的 active_project_id）
        const activeId = session.active_project_id;
        if (activeId) {
          const state = useProjectStore.getState();
          const activeProj = state.projects.find((p) => p.id === activeId) ?? null;
          if (activeProj) {
            // 非 git 项目跳过所有 git 命令
            if (activeProj.git_info === null) {
              setInitializing(false);
              return;
            }
            useProjectStore.setState({
              activeProjectId: activeId,
              activeProject: activeProj,
            });

            // 触发 git info 刷新，确保 commit panel 立即展示数据
            const defaultGitInfo = {
              current_branch: '',
              branches: [] as string[],
              worktrees: [] as Worktree[],
              git_provider: '',
            };
            const patchGitInfo = (patch: Partial<typeof defaultGitInfo>) => {
              useProjectStore.setState((s) => {
                const nextProjects = s.projects.map((p) =>
                  p.id === activeId
                    ? { ...p, git_info: { ...(p.git_info ?? defaultGitInfo), ...patch } }
                    : p,
                );
                return {
                  projects: nextProjects,
                  activeProject:
                    s.activeProjectId === activeId
                      ? (nextProjects.find((p) => p.id === activeId) ?? s.activeProject)
                      : s.activeProject,
                };
              });
            };
            // 不在这里拉 status：激活哪个单元由下面的恢复流程决定，
            // 统一由 useActiveRepoUnitSync 挂载 + 取首个快照（避免旧实现里
            // 「先按主仓拉一次、随后才恢复 worktree」导致首屏显示主仓内容）。
            getGitBranchInfo(activeId)
              .then(async (branchInfo) => {
                patchGitInfo({
                  branches: branchInfo.branches,
                  worktrees: branchInfo.worktrees,
                });
                // 恢复上次激活的 worktree（session 只持久化了 path）：
                // worktrees 此刻已加载，可校验 worktree 仍存在；且校验 effect
                // 对空 worktrees 不再清理激活态，避免「先清后加载」竞态。
                // 恢复上次激活的单元：只写单一表示 byProject[projectId]
                // （旧实现同时写三份镜像字段，读镜像的事件回调因此会拿到别的单元的路径）
                const restoredWtPath = wtState?.[activeId];
                if (restoredWtPath) {
                  const store = useWorktreeStore.getState();
                  // 清单路径已由后端归一出 canonical（见 backend/git-domain §12），
                  // 但 session 文件里存的是**上一次写入**的路径，历史版本可能非 canonical
                  // （macOS 的 `/tmp` 与 `/private/tmp` 同指一处）。因此只对「持久化输入」
                  // 做一次归一，再与清单比一次 —— 清单侧不需要第二次比对：归一之后
                  // 同一单元只有一种形态，多一次比对就是第二种身份判据。
                  const canonical = await canonicalWorktreePath(activeId, restoredWtPath).catch(
                    () => restoredWtPath,
                  );
                  const wt = branchInfo.worktrees.find((w) => w.path === canonical);
                  if (wt) {
                    store.markWorktreeOpened(activeId, wt.path, wt.branch);
                    store.setActiveWorktree(activeId, wt.path, wt.branch);
                  } else {
                    // 认不出 ⇒ 交回唯一判死点（`useAppShellData` 的清单校验）判「工作树已消失」，
                    // 这里不重复判死：两处各有各的「不存在」会互相打架，实测 main ↔ worktree
                    // 反复重挂。
                    store.setActiveWorktree(activeId, canonical);
                  }
                }
              })
              .catch((err) => reportFrontendError('session.gitBranchInfo', err));
          }
        }

        setInitializing(false);
      })
      .catch((err) => {
        // load_session 失败（纯浏览器环境 / session 文件损坏 / IPC 错误）：
        // 必须同样退出 splash，否则 initializing 永远为 true（splash 永挂）
        console.error('[Bootstrap] load_session failed:', err);
        reportFrontendError('session.loadSession', err);
        setInitializing(false);
      });

    return () => clearTimeout(hardTimeout);
  }, [loadProjects, restoreWorktreeState]);

  return { initialSidebarWidth, initializing };
}

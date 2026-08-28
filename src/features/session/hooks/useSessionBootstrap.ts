import { useState, useEffect } from 'react';

import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { FileChange, Worktree } from '@/shared/types';
import { reportFrontendError } from '@/shared/utils/errorReporting';

/* eslint-disable import/no-restricted-paths -- session bootstrap needs git API for reading git info */
import { getIgnoredFiles, getWorktreeChangedFiles, getGitBranchInfo } from '../../git/api/gitApi';
import { useGitStatusEventsSync } from '../../git/hooks/useGitStatusEventsSync';
/* eslint-enable import/no-restricted-paths */
// eslint-disable-next-line import/no-restricted-paths -- session bootstrap needs project API for listing projects
import { listProjects } from '../../project/api/projectApi';
import { loadSession } from '../api/sessionApi';

export function useSessionBootstrap(deps: {
  loadProjects: () => Promise<void>;
  restoreWorktreeState: (worktreeState: Record<string, string>) => void;
}) {
  const [initialSidebarWidth, setInitialSidebarWidth] = useState<number>(280);
  const [initializing, setInitializing] = useState(true);

  const { loadProjects, restoreWorktreeState } = deps;

  // git 状态事件流同步（git-changed 全量刷新 + git-status-diff 增量 patch），
  // 监听注册与去抖调度在 useGitStatusEventsSync 内部自管理
  useGitStatusEventsSync();

  useEffect(() => {
    loadProjects().then(async () => {
      try {
        const projects = await listProjects();
        const defaultGitInfo = {
          current_branch: '',
          branches: [] as string[],
          worktrees: [] as Worktree[],
          changed_files: [] as FileChange[],
          is_clean: true,
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
          if (!p.git_info.changed_files?.length) {
            // split 轻量路径：与 watcher git-changed 处理一致，避免重量级 refresh_git_info
            getWorktreeChangedFiles(p.id, '')
              .then((changedFiles) => {
                patchGitInfo(p.id, {
                  changed_files: changedFiles,
                  is_clean: changedFiles.length === 0,
                });
              })
              .catch((err) => reportFrontendError('session.gitChangedFiles', err));

            getGitBranchInfo(p.id)
              .then((branchInfo) => {
                patchGitInfo(p.id, {
                  current_branch: branchInfo.current_branch,
                  branches: branchInfo.branches,
                  worktrees: branchInfo.worktrees,
                });
              })
              .catch((err) => reportFrontendError('session.gitBranchInfo', err));
          }
          // 忽略文件列表（.gitignore），供文件树灰色显示。写入 gitStore 独立状态 ——
          // git_info 会被项目列表刷新用 Rust 返回值整体重建（无此字段），寄生存不可靠。
          // 与变更解耦、仅在缺失时补拉一次，避免重复付出全树 --ignored 遍历的成本。
          if (!useGitStore.getState().ignoredByProject[p.id]?.length) {
            getIgnoredFiles(p.id, '')
              .then((ignoredFiles) => {
                useGitStore.getState().setIgnoredFiles(p.id, ignoredFiles);
              })
              .catch((err) => reportFrontendError('session.gitIgnoredFiles', err));
          }
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
              changed_files: [] as FileChange[],
              is_clean: true,
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
            getWorktreeChangedFiles(activeId, '')
              .then((changedFiles) => {
                patchGitInfo({ changed_files: changedFiles, is_clean: changedFiles.length === 0 });
              })
              .catch((err) => reportFrontendError('session.gitChangedFiles', err));
            // 恢复激活项目同样补拉忽略列表（快照缺失时一次性成本，写入 gitStore）
            if (!useGitStore.getState().ignoredByProject[activeId]?.length) {
              getIgnoredFiles(activeId, '')
                .then((ignoredFiles) => {
                  useGitStore.getState().setIgnoredFiles(activeId, ignoredFiles);
                })
                .catch((err) => reportFrontendError('session.gitIgnoredFiles', err));
            }
            getGitBranchInfo(activeId)
              .then((branchInfo) => {
                patchGitInfo({
                  current_branch: branchInfo.current_branch,
                  branches: branchInfo.branches,
                  worktrees: branchInfo.worktrees,
                });
                // 恢复上次激活的 worktree（session 只持久化了 path）：
                // worktrees 此刻已加载，可校验 worktree 仍存在；且校验 effect
                // 对空 worktrees 不再清理激活态，避免「先清后加载」竞态。
                const restoredWtPath = wtState?.[activeId];
                if (restoredWtPath) {
                  const wt = branchInfo.worktrees.find((w) => w.path === restoredWtPath);
                  if (wt) {
                    useWorktreeStore.setState((s) => {
                      const prev = s.worktreeStateMap[activeId] ?? {
                        activePath: null,
                        activeBranch: '',
                        opened: [] as { path: string; branch: string }[],
                      };
                      const opened = prev.opened.some((o) => o.path === wt.path)
                        ? prev.opened
                        : [...prev.opened, { path: wt.path, branch: wt.branch }];
                      return {
                        worktreeStateMap: {
                          ...s.worktreeStateMap,
                          [activeId]: {
                            activePath: wt.path,
                            activeBranch: wt.branch,
                            opened,
                          },
                        },
                        activeWorktreePath: wt.path,
                        activeWorktreeBranch: wt.branch,
                        openedWorktrees: opened,
                      };
                    });
                  }
                }
              })
              .catch((err) => reportFrontendError('session.gitBranchInfo', err));
          }
        }

        setInitializing(false);
      })
      .catch(console.error);
  }, [loadProjects, restoreWorktreeState]);

  return { initialSidebarWidth, initializing };
}

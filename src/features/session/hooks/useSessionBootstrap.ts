import { listen } from '@tauri-apps/api/event';
import { useState, useEffect } from 'react';

import { GIT_CHANGED_EVENT, GIT_STATUS_DIFF_EVENT } from '@/shared/events';
import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { FileChange, Worktree, GitStatusDiff } from '@/shared/types';
import { aheadBehindKey } from '@/shared/utils/aheadBehindKey';
import { reportFrontendError } from '@/shared/utils/errorReporting';

/* eslint-disable import/no-restricted-paths -- session bootstrap needs git API for reading git info */
import {
  getIgnoredFiles,
  getWorktreeChangedFiles,
  getGitBranchInfo,
  getAheadBehind,
} from '../../git/api/gitApi';
import { refreshGitFileStates, createDebouncedGitRefresh } from '../../git/utils/gitStatus';
/* eslint-enable import/no-restricted-paths */
// eslint-disable-next-line import/no-restricted-paths -- session bootstrap needs project API for listing projects
import { listProjects } from '../../project/api/projectApi';
import { loadSession } from '../api/sessionApi';

/** 将后端 git status 字符串映射为前端 FileChange.status */
function mapGitStatus(status: string): FileChange['status'] {
  switch (status) {
    case 'Untracked':
      return 'Untracked';
    case 'Added':
      return 'Added';
    case 'Deleted':
      return 'Deleted';
    case 'Renamed':
      return 'Renamed';
    default:
      return 'Modified';
  }
}

export function useSessionBootstrap(deps: {
  loadProjects: () => Promise<void>;
  restoreWorktreeState: (worktreeState: Record<string, string>) => void;
}) {
  const [initialSidebarWidth, setInitialSidebarWidth] = useState<number>(280);
  const [initializing, setInitializing] = useState(true);

  const { loadProjects, restoreWorktreeState } = deps;

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
          ignored_files: [] as string[],
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
          if (!p.git_info?.changed_files?.length) {
            // split 轻量路径：与 watcher git-changed 处理一致，避免重量级 refresh_git_info
            getWorktreeChangedFiles(p.id, '')
              .then((changedFiles) => {
                patchGitInfo(p.id, {
                  changed_files: changedFiles,
                  is_clean: changedFiles.length === 0,
                });
              })
              .catch((err) => reportFrontendError('session.gitChangedFiles', err));

            // 忽略文件列表（.gitignore），供文件树灰色显示
            getIgnoredFiles(p.id, '')
              .then((ignoredFiles) => {
                patchGitInfo(p.id, { ignored_files: ignoredFiles });
              })
              .catch((err) => reportFrontendError('session.gitIgnoredFiles', err));

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
            getGitBranchInfo(activeId)
              .then((branchInfo) => {
                patchGitInfo({
                  current_branch: branchInfo.current_branch,
                  branches: branchInfo.branches,
                  worktrees: branchInfo.worktrees,
                });
              })
              .catch((err) => reportFrontendError('session.gitBranchInfo', err));
          }
        }

        setInitializing(false);
      })
      .catch(console.error);

    // git-changed 全量刷新合并：build 期间事件高频爆发时，同一 projectId 的
    // 全量刷新（changed_files + ignored_files + 分支 + ahead/behind）在静默
    // 窗口内只执行一次，从根上封顶刷新频率（增量 diff 事件仍是即时主路径）。
    const gitChangedDebounce = createDebouncedGitRefresh(500);

    const unlistenPromise = listen<string>(GIT_CHANGED_EVENT, (event) => {
      const projectId = event.payload;
      // worktree 激活时按 activeWorktreePath 刷新（HEAD watcher 监听 .git/worktrees
      // 目录后，worktree 内切分支也会触发本事件，需请求 worktree 的数据）
      const worktreePath = useWorktreeStore.getState().activeWorktreePath ?? '';

      // 去抖合并：窗口结束才执行，worktreePath 取窗口内最新一次调度的值
      gitChangedDebounce.schedule(projectId, worktreePath, (latestWorktreePath) => {
        // split 轻量路径：分别获取 changed_files 与 branch_info，避免全量 refresh_git_info
        const defaultGitInfo = {
          current_branch: '',
          branches: [] as string[],
          worktrees: [] as Worktree[],
          changed_files: [] as FileChange[],
          is_clean: true,
          git_provider: '',
        };

        const updateGitInfo = (patch: Partial<typeof defaultGitInfo>) => {
          useProjectStore.setState((state) => {
            const nextProjects = state.projects.map((p) => {
              if (p.id !== projectId) return p;
              return { ...p, git_info: { ...(p.git_info ?? defaultGitInfo), ...patch } };
            });
            return {
              projects: nextProjects,
              activeProject:
                state.activeProjectId === projectId
                  ? (nextProjects.find((p) => p.id === projectId) ?? state.activeProject)
                  : state.activeProject,
            };
          });
        };

        // 1. 获取变更文件 + 忽略文件列表（轻量，同时 patch ignored_files 供文件树灰色显示）
        void refreshGitFileStates(projectId, latestWorktreePath);

        // 2. 获取分支信息（异步，不阻塞文件列表更新）
        getGitBranchInfo(projectId, latestWorktreePath)
          .then((branchInfo) => {
            // worktree 激活时保留 local 主分支名，避免 local 入口分支名跟随 worktree 变动
            const currentBranch = latestWorktreePath
              ? (useProjectStore.getState().projects.find((p) => p.id === projectId)?.git_info
                  ?.current_branch ?? branchInfo.current_branch)
              : branchInfo.current_branch;
            updateGitInfo({
              current_branch: currentBranch,
              branches: branchInfo.branches,
              worktrees: branchInfo.worktrees,
            });
          })
          .catch((e) => console.error('[SessionBootstrap] get_git_branch_info_command failed:', e));

        // 3. 同步 ahead/behind（待 push / 待 pull 数量），与 changed_files 一并刷新
        getAheadBehind(projectId, latestWorktreePath)
          .then((ab) => {
            useGitStore
              .getState()
              .setAheadBehind(aheadBehindKey('local', projectId, projectId), ab);
          })
          .catch((e) => console.error('[SessionBootstrap] get_ahead_behind failed:', e));
      });
    });

    // 增量 diff 事件：直接 patch store，无需重新请求后端
    const unlistenDiffPromise = listen<GitStatusDiff>(GIT_STATUS_DIFF_EVENT, (event) => {
      const diff = event.payload;
      if (!diff.project_id) return;
      useProjectStore.getState().patchChangedFiles(diff.project_id, {
        added: diff.added.map((f) => ({
          path: f.path,
          status: mapGitStatus(f.status),
          additions: f.additions ?? 0,
          deletions: f.deletions ?? 0,
        })),
        removed: diff.removed,
        modified: diff.modified.map((f) => ({
          path: f.path,
          status: mapGitStatus(f.status),
          additions: f.additions ?? 0,
          deletions: f.deletions ?? 0,
        })),
      });
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
      unlistenDiffPromise.then((unlisten) => unlisten());
      // 清除 pending 的全量刷新调度，避免卸载后执行 setState
      gitChangedDebounce.clear();
    };
  }, [loadProjects, restoreWorktreeState]);

  return { initialSidebarWidth, initializing };
}

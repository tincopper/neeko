import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';

import { GIT_CHANGED_EVENT, GIT_STATUS_DIFF_EVENT } from '@/shared/events';
import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { FileChange, GitStatusDiff, Worktree } from '@/shared/types';
import { aheadBehindKey } from '@/shared/utils/aheadBehindKey';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

import { getAheadBehind, getGitBranchInfo } from '../api/gitApi';
import { createDebouncedGitRefresh, refreshGitFileStates } from '../utils/gitStatus';

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

/**
 * 同步 git 状态事件流（git-changed 全量刷新 + git-status-diff 增量 patch）。
 * 由 useSessionBootstrap 在启动时挂载一次；监听生命周期与去抖调度自管理。
 */
export function useGitStatusEventsSync() {
  useEffect(() => {
    // git-changed 全量刷新合并：build 期间事件高频爆发时，同一 projectId 的
    // 全量刷新（changed_files + 分支 + ahead/behind）在静默
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

        // 1. 获取变更文件列表（轻量；ignored 列表由 bootstrap 补拉进 gitStore，不经事件流刷新）
        void refreshGitFileStates(projectId, latestWorktreePath);

        // 2. 获取分支信息（异步，不阻塞文件列表更新）。
        // 无激活 worktree 时 latestWorktreePath 为 ''，需转成 null 发送，
        // 否则 Rust 端会把 "" 当字面路径、落到 shell 回退在 app CWD 跑 git（回归）。
        const repoPathArg = latestWorktreePath || null;
        getGitBranchInfo(projectId, repoPathArg)
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
        getAheadBehind(projectId, repoPathArg)
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
      unlistenPromise.then((unlisten) => safeUnlisten(unlisten)());
      unlistenDiffPromise.then((unlisten) => safeUnlisten(unlisten)());
      // 清除 pending 的全量刷新调度，避免卸载后执行 setState
      gitChangedDebounce.clear();
    };
  }, []);
}

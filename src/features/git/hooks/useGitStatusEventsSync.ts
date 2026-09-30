import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';

import { GIT_CHANGED_EVENT, GIT_STATUS_SNAPSHOT_EVENT } from '@/shared/events';
import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { activeRepoKeyOf } from '@/shared/store/worktreeStore';
import type { GitChangedEvent, GitStatusSnapshot } from '@/shared/types';
import { parseRepoKey } from '@/shared/utils/repoRef';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

import { getAheadBehind, getGitBranchInfo } from '../api/gitApi';
import { createDebouncedStatusRefresh, refreshRepoStatus } from '../utils/gitStatus';

/** 拉取某单元的分支清单 / 工作树清单 / ahead-behind（status 快照不携带这些）。 */
function refreshUnitBranchInfo(repoKey: string): void {
  const { projectId, worktreePath } = parseRepoKey(repoKey);
  const store = useProjectStore.getState();
  const project = store.projects.find((p) => p.id === projectId);
  if (!project || project.git_info === null) return;

  getGitBranchInfo(projectId, worktreePath)
    .then((branchInfo) => {
      // branches / worktrees 是 per-project（同一仓库共享 refs 与 worktree 清单）；
      // 当前分支不再从这里写 —— 它是 per 单元 的事实，唯一写者是 applyStatus
      // （主仓单元投影到项目卡片，worktree 单元留在各自槽位）。
      useProjectStore.setState((state) => ({
        projects: state.projects.map((p) =>
          p.id === projectId && p.git_info
            ? {
                ...p,
                git_info: {
                  ...p.git_info,
                  branches: branchInfo.branches,
                  worktrees: branchInfo.worktrees,
                },
              }
            : p,
        ),
      }));
    })
    .catch((e) => console.error('[git] get_git_branch_info failed:', e));

  getAheadBehind(projectId, worktreePath)
    .then((ab) =>
      // 键 = 该单元身份（`repoKey` 已是 `RepoKey`，ahead/behind 与连接形态无关）
      useGitStore.getState().setAheadBehind(repoKey, ab),
    )
    .catch((e) => console.error('[git] get_ahead_behind failed:', e));
}

/**
 * 同步 git 状态事件流。协议要点（身份补全后）：
 * - `git-status-snapshot`：按 `repo_key` **定址**写入该单元的槽位，version gate 在
 *   `applyStatus` 内按单元判定。**不存在**「worktree 激活时丢弃主仓快照」这类守卫 ——
 *   主仓快照写主仓槽天经地义，视图渲染哪个槽由「当前单元」决定。
 * - `git-changed`：载荷带 `repo_key`，因此刷新目标由事件本身决定，不再从全局镜像猜。
 * - 窗口聚焦：平台 watcher 有丢事件缺陷（inotify 溢出 / FSEvents 延迟聚合），聚焦时对
 *   **当前视图单元** hint 一次（幂等，worker 的查询-比较闸门兜底）。
 */
export function useGitStatusEventsSync() {
  useEffect(() => {
    const debounce = createDebouncedStatusRefresh(500);

    const unlistenChanged = listen<GitChangedEvent>(GIT_CHANGED_EVENT, (event) => {
      const { repo_key: repoKey } = event.payload;
      debounce.schedule(repoKey, (key) => {
        void refreshRepoStatus(key);
        refreshUnitBranchInfo(key);
      });
    });

    const unlistenSnapshot = listen<GitStatusSnapshot>(GIT_STATUS_SNAPSHOT_EVENT, (event) => {
      const snap = event.payload;
      const store = useProjectStore.getState();
      const prevBranch = store.statuses[snap.repo_key]?.branch;
      store.applyStatus(snap);
      useGitStore.getState().setStatusTruncated(snap.repo_key, snap.truncated);
      // 分支变化 → 该单元的分支清单 / ahead-behind 需要重取（status 快照不含这些）
      if (snap.branch && snap.branch !== prevBranch) {
        debounce.schedule(snap.repo_key, (key) => refreshUnitBranchInfo(key));
      }
    });

    const unlistenFocus = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) return;
      // 当前视图所在单元 —— 经唯一派生点取（见 worktreeStore.selectActiveRepoKey）
      const key = activeRepoKeyOf();
      if (!key) return;
      debounce.schedule(key, (k) => void refreshRepoStatus(k));
    });

    return () => {
      void unlistenChanged.then((fn) => safeUnlisten(fn)());
      void unlistenSnapshot.then((fn) => safeUnlisten(fn)());
      void unlistenFocus.then((fn) => safeUnlisten(fn)());
      debounce.clear();
    };
  }, []);
}

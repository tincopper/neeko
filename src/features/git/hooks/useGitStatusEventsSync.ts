import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';

import { GIT_CHANGED_EVENT, GIT_STATUS_SNAPSHOT_EVENT } from '@/shared/events';
import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore, selectStatus } from '@/shared/store/projectStore';
import { activeWorkspaceKeyOf } from '@/shared/store/workspaceStore';
import type { GitChangedEvent, GitStatusSnapshot } from '@/shared/types';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { getGitBranchInfo } from '../api/gitApi';
import { createDebouncedStatusRefresh, refreshWorkspaceStatus } from '../utils/gitStatus';

/** 拉取某单元的分支清单 / 工作树清单（status 快照不携带这些）。
 *  ahead/behind 不再从这里取 —— 它由权威快照 `git-status-snapshot` 单通道携带（见下方 handler）。 */
function refreshUnitBranchInfo(workspaceKey: string): void {
  const { projectId, worktreePath } = WorkspaceSession.fromKeyOrId(workspaceKey);
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
}

/**
 * 同步 git 状态事件流。协议要点（身份补全后）：
 * - `git-status-snapshot`：按 `workspace_key` **定址**写入该单元的槽位，version gate 在
 *   `applyStatus` 内按单元判定。**不存在**「worktree 激活时丢弃主仓快照」这类守卫 ——
 *   主仓快照写主仓槽天经地义，视图渲染哪个槽由「当前单元」决定。ahead/behind 与
 *   entries/branch **同属这份快照**，由同一生产者同批产出 —— 这是 ahead/behind 的
 *   唯一权威通道（不再各自触发独立的 `getAheadBehind` pull）。
 * - `git-changed`：载荷带 `workspace_key`，因此刷新目标由事件本身决定，不再从全局镜像猜。
 * - 窗口聚焦：平台 watcher 有丢事件缺陷（inotify 溢出 / FSEvents 延迟聚合），聚焦时对
 *   **当前视图单元** hint 一次（幂等，worker 的查询-比较闸门兜底）。
 */
export function useGitStatusEventsSync() {
  useEffect(() => {
    const debounce = createDebouncedStatusRefresh(500);

    const unlistenChanged = listen<GitChangedEvent>(GIT_CHANGED_EVENT, (event) => {
      const { workspace_key: workspaceKey } = event.payload;
      debounce.schedule(workspaceKey, (key) => {
        void refreshWorkspaceStatus(key);
        refreshUnitBranchInfo(key);
      });
    });

    const unlistenSnapshot = listen<GitStatusSnapshot>(GIT_STATUS_SNAPSHOT_EVENT, (event) => {
      const snap = event.payload;
      const store = useProjectStore.getState();
      const prevBranch = selectStatus(store, snap.workspace_key)?.branch;
      const applied = store.applyStatus(snap);
      // 陈旧快照被 version gate 拒绝时，**整份快照作废**：
      // ahead/behind / truncated 会把徽标打回旧值；拿陈旧分支与当前分支比较
      // 还会排一次多余的分支清单刷新。故所有派生副作用一并收进 `applied`。
      if (applied) {
        useGitStore
          .getState()
          .setAheadBehind(snap.workspace_key, { ahead: snap.ahead, behind: snap.behind });
        useGitStore.getState().setStatusTruncated(snap.workspace_key, snap.truncated);
        // 分支变化 → 该单元的**分支清单**需要重取（ahead/behind 已随快照自身携带，不在此列）
        if (snap.branch && snap.branch !== prevBranch) {
          debounce.schedule(snap.workspace_key, (key) => refreshUnitBranchInfo(key));
        }
      }
    });

    const unlistenFocus = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) return;
      // 当前视图所在单元 —— 经唯一派生点取（见 workspaceStore.selectActiveWorkspaceKey）
      const key = activeWorkspaceKeyOf();
      if (!key) return;
      debounce.schedule(key, (k) => void refreshWorkspaceStatus(k));
    });

    return () => {
      void unlistenChanged.then((fn) => safeUnlisten(fn)());
      void unlistenSnapshot.then((fn) => safeUnlisten(fn)());
      void unlistenFocus.then((fn) => safeUnlisten(fn)());
      debounce.clear();
    };
  }, []);
}

import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';

import { GIT_CHANGED_EVENT, GIT_STATUS_SNAPSHOT_EVENT } from '@/shared/events';
import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore, versionGateAccepts } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { FileChange, GitStatusSnapshot, Worktree } from '@/shared/types';
import { aheadBehindKey } from '@/shared/utils/aheadBehindKey';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

import { getAheadBehind, getGitBranchInfo } from '../api/gitApi';
import { createDebouncedGitRefresh, refreshGitFileStates } from '../utils/gitStatus';

/** 读当前 store 中某项目已展示的分支名（供快照事件判断分支是否变化） */
function currentStoredBranch(projectId: string): string | undefined {
  return useProjectStore.getState().projects.find((p) => p.id === projectId)?.git_info
    ?.current_branch;
}

/** git_info 默认形状（applyGitStatus 的兜底零值） */
function emptyGitInfoPatch(): {
  current_branch: string;
  branches: string[];
  worktrees: Worktree[];
  changed_files: FileChange[];
  is_clean: boolean;
  git_provider: string;
} {
  return {
    current_branch: '',
    branches: [],
    worktrees: [],
    changed_files: [],
    is_clean: true,
    git_provider: '',
  };
}

/**
 * 同步 git 状态事件流（G2 协议 v2）：
 * - `git-status-snapshot`：versioned 全量快照 → version gate 后整体替换 changed_files
 *   （单一权威，D3/D4；增量 patch 路径已删除）。分支变化顺带刷新 branch/ahead-behind。
 * - `git-changed`：worktree HEAD / 索引等外部变化 → debounce 后补拉分支/ahead-behind
 *   与 changed_files（主路径读接口已收编为快照，幂等；worktree 路径走 transport 兜底）。
 * 由 useSessionBootstrap 在启动时挂载一次；监听生命周期与去抖调度自管理。
 */
export function useGitStatusEventsSync() {
  useEffect(() => {
    // git-changed（worktree 外部变化）刷新合并：同一 projectId 的多次调度在
    // 静默窗口内只执行一次，封顶刷新频率。
    const gitChangedDebounce = createDebouncedGitRefresh(500);

    const unlistenPromise = listen<string>(GIT_CHANGED_EVENT, (event) => {
      const projectId = event.payload;
      // worktree 激活时按 activeWorktreePath 刷新（HEAD watcher 监听 .git/worktrees
      // 目录后，worktree 内切分支也会触发本事件，需请求 worktree 的数据）
      const worktreePath = useWorktreeStore.getState().activeWorktreePath ?? '';

      // 去抖合并：窗口结束才执行，worktreePath 取窗口内最新一次调度的值
      gitChangedDebounce.schedule(projectId, worktreePath, (latestWorktreePath) => {
        const updateGitInfo = (patch: Partial<ReturnType<typeof emptyGitInfoPatch>>) => {
          useProjectStore.setState((state) => {
            const nextProjects = state.projects.map((p) => {
              if (p.id !== projectId) return p;
              return { ...p, git_info: { ...(p.git_info ?? emptyGitInfoPatch()), ...patch } };
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

        // 1. 变更文件列表（主路径读接口已收编为 watcher 快照；worktree 走 transport）
        void refreshGitFileStates(projectId, latestWorktreePath);

        // 2. 分支信息（异步，不阻塞文件列表更新）。
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

    // G2 事件协议 v2：versioned 全量快照 → version gate → 整体替换（无增量 patch）。
    // 注意：此监听与上面的 git-changed 监听共用 gitChangedDebounce（快照分支变化场景）。
    const unlistenSnapshotPromise = listen<GitStatusSnapshot>(
      GIT_STATUS_SNAPSHOT_EVENT,
      (event) => {
        const snap = event.payload;
        if (!snap.project_id) return;
        // worktree 激活时主仓库快照不落 store —— 单槽位视图正展示 worktree 数据，
        // 主快照写入会覆盖它（G3 worktree watcher 统一后消除此分支）。
        // 切回主视图由下方 worktreeStore 订阅触发主路径 refresh（allowEqual 幂等恢复）。
        if (useWorktreeStore.getState().activeWorktreePath) return;
        if (!versionGateAccepts(snap.project_id, snap.version)) return;
        // G4：截断状态进 store（ChangesList 顶部 banner 消费；P3 截断显式化）
        useGitStore.getState().setStatusTruncated(snap.project_id, snap.truncated);

        const prevBranch = currentStoredBranch(snap.project_id);
        useProjectStore.getState().applyGitStatus(snap.project_id, snap.entries, snap.branch);

        // 分支变化 → 刷新 branch 列表与 ahead/behind（未变不调度，避免高频多余请求）
        if (snap.branch && snap.branch !== prevBranch) {
          gitChangedDebounce.schedule(snap.project_id, '', (latestWorktreePath) => {
            const repoPathArg = latestWorktreePath || null;
            getGitBranchInfo(snap.project_id, repoPathArg)
              .then((bi) => {
                useProjectStore.setState((state) => ({
                  projects: state.projects.map((p) =>
                    p.id === snap.project_id
                      ? {
                          ...p,
                          git_info: {
                            ...(p.git_info ?? emptyGitInfoPatch()),
                            current_branch: bi.current_branch,
                            branches: bi.branches,
                            worktrees: bi.worktrees,
                          },
                        }
                      : p,
                  ),
                }));
              })
              .catch(() => undefined);
            getAheadBehind(snap.project_id, repoPathArg)
              .then((ab) =>
                useGitStore
                  .getState()
                  .setAheadBehind(aheadBehindKey('local', snap.project_id, snap.project_id), ab),
              )
              .catch(() => undefined);
          });
        }
      },
    );

    // 窗口重新聚焦（VSCode 触发源⑤ onWindowFocus 对标）：平台 watcher 有丢事件
    // 缺陷（inotify 溢出 / FSEvents 延迟聚合），聚焦时对活跃项目 hint 一次 status
    // 查询（worker 查询-比较闸门兜底幂等）。去抖合并避免快速 Alt+Tab 风暴。
    const unlistenFocusPromise = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) return;
      const pid = useProjectStore.getState().activeProjectId;
      if (!pid) return;
      gitChangedDebounce.schedule(pid, '', (wt) => {
        void refreshGitFileStates(pid, wt);
      });
    });

    // 切回主视图（activeWorktreePath → null）：主动触发一次主路径刷新，
    // 恢复主仓库 changed_files（worktree 激活期间主快照被跳过、可能残留 worktree 数据）。
    const unsubscribeWt = useWorktreeStore.subscribe((state, prev) => {
      if (state.activeWorktreePath === null && prev.activeWorktreePath !== null) {
        const pid = useProjectStore.getState().activeProjectId;
        if (!pid) return;
        gitChangedDebounce.schedule(pid, '', (wt) => {
          void refreshGitFileStates(pid, wt);
        });
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => safeUnlisten(unlisten)());
      unlistenSnapshotPromise.then((unlisten) => safeUnlisten(unlisten)());
      unlistenFocusPromise.then((unlisten) => safeUnlisten(unlisten)());
      unsubscribeWt();
      // 清除 pending 的刷新调度，避免卸载后执行 setState
      gitChangedDebounce.clear();
    };
  }, []);
}

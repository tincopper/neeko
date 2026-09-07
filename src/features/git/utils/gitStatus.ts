import { useProjectStore, versionGateAccepts } from '@/shared/store/projectStore';
import type { GitInfo } from '@/shared/types';

import { getWorktreeChangedFilesVersioned } from '../api/gitApi';

// 避免 build 期间并发的慢请求覆盖新快照：同一 projectId 只允许最新一代的 setState 生效
const refreshGenerations = new Map<string, number>();

/**
 * 创建 per-project 去抖合并调度器：同一 key（projectId）在窗口内多次调度
 * 只执行一次（滑动窗口，窗口结束时以最新一次调度的 worktreePath 执行）。
 *
 * 第一性原理：`git-changed` 事件在 build 期间高频爆发，若每个事件都立即执行
 * 全量刷新（get_worktree_changed_files 等多个 spawn_blocking 调用）
 * 会造成刷新风暴。本调度器把「每次事件一次全量刷新」降为
 * 「每段静默窗口一次」，从根上封顶刷新频率；正确性由 refreshGitFileStates
 * 内部的 generation token 兜底。
 */
export function createDebouncedGitRefresh(debounceMs: number) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const worktrees = new Map<string, string>();

  return {
    /**
     * 调度一次全量刷新：若该 projectId 已有待执行的 timer 则重置窗口，
     * 并更新最新 worktreePath（worktree 切换时以最新路径为准）。
     */
    schedule(projectId: string, worktreePath: string, run: (worktreePath: string) => void) {
      worktrees.set(projectId, worktreePath);
      const existing = timers.get(projectId);
      if (existing !== undefined) clearTimeout(existing);
      timers.set(
        projectId,
        setTimeout(() => {
          timers.delete(projectId);
          const latestWorktree = worktrees.get(projectId) ?? '';
          worktrees.delete(projectId);
          run(latestWorktree);
        }, debounceMs),
      );
    },

    /** 清除全部 pending 调度（组件卸载时调用，防止卸载后执行 setState） */
    clear() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      worktrees.clear();
    },
  };
}

/**
 * 显式刷新指定项目（含 worktree）的 git 文件状态：
 * changed_files（着色）；ignored 灰显由后端读层原生标注（FileNode.ignored）。
 * 文件操作（新建/删除/重命名/保存）成功后调用，弥补文件系统 watcher
 * 只监听主项目路径、无法自动触发 worktree 内 git status 刷新的缺口。
 */
export async function refreshGitFileStates(projectId: string, worktreePath: string): Promise<void> {
  const myGen = (refreshGenerations.get(projectId) ?? 0) + 1;
  refreshGenerations.set(projectId, myGen);

  const defaultGitInfo: GitInfo = {
    current_branch: '',
    branches: [],
    worktrees: [],
    changed_files: [],
    is_clean: true,
    git_provider: '',
  };
  try {
    // S5：ignored_files 平行数组退役 —— 灰显由后端读层原生标注（FileNode.ignored）
    const changedPayload = await getWorktreeChangedFilesVersioned(projectId, worktreePath);
    // G2 D4 version gate：快照读（version>0）旧于已应用版本 → 丢弃，避免覆盖更新的快照事件；
    // version=0（WSL/SSH / worktree 兜底）恒放行，与旧行为一致。等待期间同代 refresh 由
    // refreshGenerations 兜底。
    // 主路径显式刷新 allowEqual：worktree 激活期间主快照事件被跳过（不推进版本），
    // 切回主视图时此刷新需能幂等恢复主数据（version == applied 也放行）。
    const allowEqual = worktreePath === '' && changedPayload.version > 0;
    if (!versionGateAccepts(projectId, changedPayload.version, allowEqual)) return;
    const changedFiles = changedPayload.files;
    // 等待期间若同 projectId 有更新的调用，则本代陈旧，setState 被跳过
    if (refreshGenerations.get(projectId) !== myGen) return;
    useProjectStore.setState((state) => {
      const nextProjects = state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              git_info: {
                ...(p.git_info ?? defaultGitInfo),
                changed_files: changedFiles,
                is_clean: changedFiles.length === 0,
              },
            }
          : p,
      );
      return {
        projects: nextProjects,
        activeProject:
          state.activeProjectId === projectId
            ? (nextProjects.find((p) => p.id === projectId) ?? state.activeProject)
            : state.activeProject,
      };
    });
  } catch (e) {
    console.error('[refreshGitFileStates] Failed to refresh git file states for', projectId, e);
  }
}

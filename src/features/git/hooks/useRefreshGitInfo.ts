import { useCallback, useEffect, useRef } from 'react';

import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { fallbackToMainIfWorkspaceGone } from '@/shared/store/workspaceStore';
import type { ProjectCommands, ProjectView } from '@/shared/types';

/**
 * 刷新当前项目的 git 元数据 + **当前视图所在Workspace**的 status。
 *
 * - 用 ref 读最新的 project/commands，避免「刷新 → store 更新 → commands 引用变化 →
 *   回调变化 → effect 重跑」的死循环；返回稳定引用，可安全进依赖数组。
 * - status 一律经 `applyStatus` 写（唯一写入口 + per-workspace version gate）；元数据
 *   （分支清单 / 工作树清单 / provider）是 per-project 事实，写进 `git_info`。
 * - 不再需要「worktree 激活时保留主分支名」那类特例：分支随快照按单元走，主仓单元的
 *   HEAD 由 `applyStatus` 投影到项目卡片。
 * - 不再需要 connectionContext：ahead/behind 的键就是单元身份，与连接形态无关。
 * - ahead/behind 不再在这里单独取（不再触发 `getAheadBehind`）—— 它随权威快照
 *   `git-status-snapshot` 单通道投递（见 `useGitStatusEventsSync`），冷启动由
 *   `useAheadBehindSync` 作初始种子。
 * - **清单读取即判一次**：刷新拿到的是权威 worktree 清单，若激活的 worktree 已不在其中
 *   （在别处被 `git worktree remove` 删掉）就一次性回落主仓 —— 取代旧的 render-time
 *   清单校验（C4 / prd R2.2）。
 */
export function useRefreshGitInfo(
  project: ProjectView | null,
  commands: ProjectCommands | null,
): () => Promise<void> {
  const commandsRef = useRef(commands);
  const projectRef = useRef(project);
  useEffect(() => {
    commandsRef.current = commands;
    projectRef.current = project;
  });

  return useCallback(async () => {
    const cmds = commandsRef.current;
    const proj = projectRef.current;
    if (!proj || !cmds) return;

    // 非 git 项目（store 中 git_info 为 null）跳过所有 git 命令
    const storeProject = useProjectStore.getState().projects.find((p) => p.id === proj.id);
    if (storeProject?.git_info === null) return;

    const [gitInfo, snapshot] = await Promise.all([
      cmds.refreshGitInfo(),
      cmds.refreshWorkspaceStatus(),
    ]);

    useProjectStore.setState((state) => {
      const nextProjects = state.projects.map((p) =>
        p.id === proj.id && p.git_info
          ? {
              ...p,
              git_info: {
                ...p.git_info,
                branches: gitInfo.branches,
                worktrees: gitInfo.worktrees,
                git_provider: gitInfo.git_provider,
              },
            }
          : p,
      );
      return {
        projects: nextProjects,
        activeProject:
          state.activeProjectId === proj.id
            ? (nextProjects.find((p) => p.id === proj.id) ?? state.activeProject)
            : state.activeProject,
      };
    });
    useProjectStore.getState().applyStatus(snapshot);
    useGitStore.getState().setStatusTruncated(snapshot.workspace_key, snapshot.truncated);

    // 清单读取后的**一次性**收口：激活的 worktree 不在清单里 ⇒ 回落主仓。
    // 这里**不**逐渲染比较（那是被删掉的补偿机制），只在读到权威清单的这一刻判一次。
    if (
      fallbackToMainIfWorkspaceGone(
        proj.id,
        gitInfo.worktrees.map((wt) => wt.path),
      )
    ) {
      console.warn('[worktree] active workspace gone, fell back to main');
    }
  }, []);
}

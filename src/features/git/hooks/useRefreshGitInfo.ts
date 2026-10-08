import { useCallback, useEffect, useRef } from 'react';

import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { ProjectCommands, ProjectView } from '@/shared/types';

/**
 * 刷新当前项目的 git 元数据 + **当前视图所在仓库单元**的 status。
 *
 * - 用 ref 读最新的 project/commands，避免「刷新 → store 更新 → commands 引用变化 →
 *   回调变化 → effect 重跑」的死循环；返回稳定引用，可安全进依赖数组。
 * - status 一律经 `applyStatus` 写（唯一写入口 + per-unit version gate）；元数据
 *   （分支清单 / 工作树清单 / provider）是 per-project 事实，写进 `git_info`。
 * - 不再需要「worktree 激活时保留主分支名」那类特例：分支随快照按单元走，主仓单元的
 *   HEAD 由 `applyStatus` 投影到项目卡片。
 * - 不再需要 connectionContext：ahead/behind 的键就是单元身份，与连接形态无关。
 * - ahead/behind 不再在这里单独取（不再触发 `getAheadBehind`）—— 它随权威快照
 *   `git-status-snapshot` 单通道投递（见 `useGitStatusEventsSync`），冷启动由
 *   `useAheadBehindSync` 作初始种子。
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
      cmds.refreshRepoStatus(),
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
    useGitStore.getState().setStatusTruncated(snapshot.repo_key, snapshot.truncated);
  }, []);
}

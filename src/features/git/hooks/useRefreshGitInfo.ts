import { useCallback, useEffect, useRef } from 'react';

import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { ConnectionContext, ProjectCommands, ProjectView } from '@/shared/types';
import { aheadBehindKey } from '@/shared/utils/aheadBehindKey';
import { mergeGitInfoForStore } from '@/shared/utils/git';

/**
 * 刷新当前项目的 git_info 并同步 ahead/behind 到全局 store（单数据源）。
 *
 * - 内部用 ref 读取最新 project/commands/connectionContext，避免依赖循环：
 *   刷新会更新 projectStore → activeProject 变化 → commands 引用变化 → 回调引用变化
 *   → effect 重跑的死循环（重构前 wrapper 里用 refs 打破的同一个循环）。
 * - 返回稳定引用回调，可安全放入 effect 依赖 / 传给子组件。
 * - ahead/behind 刷新失败不阻塞主流程（与重构前语义一致）。
 */
export function useRefreshGitInfo(
  project: ProjectView | null,
  commands: ProjectCommands | null,
  connectionContext: ConnectionContext | null,
): () => Promise<void> {
  const commandsRef = useRef(commands);
  const projectRef = useRef(project);
  const connectionContextRef = useRef(connectionContext);
  useEffect(() => {
    commandsRef.current = commands;
    projectRef.current = project;
    connectionContextRef.current = connectionContext;
  });

  return useCallback(async () => {
    const cmds = commandsRef.current;
    const proj = projectRef.current;
    const cc = connectionContextRef.current;
    if (!proj || !cmds) return;

    // 非 git 项目（store 中 git_info 为 null）跳过所有 git 命令，
    // 避免对非 git 仓库执行 git rev-parse / git status 等命令。
    const storeProject = useProjectStore.getState().projects.find((p) => p.id === proj.id);
    if (storeProject?.git_info === null) return;

    const gitInfo = await cmds.refreshGitInfo();
    // worktree 激活时保留 local 主分支名，避免 store 中 current_branch 被 worktree 分支污染
    const worktreeActive = useWorktreeStore.getState().activeWorktreePath != null;
    useProjectStore.setState((state) => {
      const nextProjects = state.projects.map((p) =>
        p.id === proj.id
          ? { ...p, git_info: mergeGitInfoForStore(p.git_info, gitInfo, worktreeActive) }
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

    // Sync ahead/behind to global store for sidebar
    try {
      const ab = await cmds.getAheadBehind();
      if (cc?.type === 'wsl') {
        useGitStore.getState().setAheadBehind(aheadBehindKey('wsl', cc.distro, proj.id), ab);
      } else if (cc?.type === 'remote') {
        useGitStore.getState().setAheadBehind(aheadBehindKey('remote', cc.host, proj.id), ab);
      } else {
        useGitStore.getState().setAheadBehind(aheadBehindKey('local', proj.id, proj.id), ab);
      }
    } catch {
      // ahead/behind 刷新失败不应阻塞主流程
    }
  }, []);
}

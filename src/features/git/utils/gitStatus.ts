import { useProjectStore } from '@/shared/store/projectStore';
import type { GitInfo } from '@/shared/types';

import { getIgnoredFiles, getWorktreeChangedFiles } from '../api/gitApi';

/**
 * 显式刷新指定项目（含 worktree）的 git 文件状态：
 * changed_files（着色）+ ignored_files（.gitignore 忽略项，文件树灰色显示）。
 * 文件操作（新建/删除/重命名/保存）成功后调用，弥补文件系统 watcher
 * 只监听主项目路径、无法自动触发 worktree 内 git status 刷新的缺口。
 */
export async function refreshGitFileStates(projectId: string, worktreePath: string): Promise<void> {
  const defaultGitInfo: GitInfo = {
    current_branch: '',
    branches: [],
    worktrees: [],
    changed_files: [],
    is_clean: true,
    git_provider: '',
  };
  try {
    const [changedFiles, ignoredFiles] = await Promise.all([
      getWorktreeChangedFiles(projectId, worktreePath),
      // 非 git 仓库时 get_ignored_files 会失败，回退为空列表
      getIgnoredFiles(projectId, worktreePath).catch(() => []),
    ]);
    useProjectStore.setState((state) => {
      const nextProjects = state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              git_info: {
                ...(p.git_info ?? defaultGitInfo),
                changed_files: changedFiles,
                is_clean: changedFiles.length === 0,
                ignored_files: ignoredFiles,
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

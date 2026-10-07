import React, { useMemo } from 'react';

import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore, selectEntries } from '@/shared/store/projectStore';
import { selectActiveWorktreePath, useWorktreeStore } from '@/shared/store/worktreeStore';
import type { Project } from '@/shared/types';
import { repoKeyOf } from '@/shared/utils/repoRef';

import SessionRow from './SessionRow';
import WorktreeList from './WorktreeList';

interface ProjectGitSectionProps {
  project: Project;
  isActive: boolean;
  /** 由父级派生的 Ctrl+N shortcut（hover 时展示） */
  shortcut?: string;
  actions: {
    onSelectProject: (projectId: string) => void;
    onRefreshGit: (projectId: string) => void;
    onOpenWorktreeTerminal?: (projectId: string, worktreePath: string, branch: string) => void;
    onShowToast?: (message: string, type?: 'info' | 'error') => void;
  };
}

/**
 * ProjectGitSection —�?渲染项目 group 展开后的 session 列表�?
 * 1. 主终端行�?local"�?
 * 2. 每个 worktree 行（�?WorktreeList 负责，附�?+A -D chip �?trash/rename 控件�?
 */
function ProjectGitSection({ project, isActive, shortcut, actions }: ProjectGitSectionProps) {
  const { onSelectProject, onRefreshGit, onOpenWorktreeTerminal, onShowToast } = actions;

  const worktrees = project.git_info?.worktrees ?? [];
  // 响应式读取（渲染期读 `getState()` 会停在旧值：切回主仓时高亮不更新）
  const activeWorktreePath = useWorktreeStore((s) => selectActiveWorktreePath(s, project.id));
  /** 主仓单元的键：本行显示的一切（ahead/behind、+A -D 聚合）都取主仓单元。 */
  const mainRepoKey = repoKeyOf(project.id, null);

  // local 主终端行的 ahead/behind 取**主仓单元**的键（旧实现的 `local:{projectId}` 键没有任何写
  // 入侧，于是徽标恒空）；该数字只在主仓视图（`localActive`）显示，与 worktree 的数字互不相关。
  const aheadBehind = useGitStore((s) => s.aheadBehind[mainRepoKey]);

  // local 主终端的 +A -D 聚合自**主仓单元**的 status（worktree 的变更不进这里）
  const mainEntries = useProjectStore((s) => selectEntries(s, mainRepoKey));
  const localChanges = useMemo(() => {
    const files = mainEntries ?? [];
    if (files.length === 0) return undefined;
    const add = files.reduce((s, f) => s + f.additions, 0);
    const del = files.reduce((s, f) => s + f.deletions, 0);
    if (add === 0 && del === 0) return undefined;
    return { add, del };
  }, [mainEntries]);

  const localActive = isActive && !activeWorktreePath;

  return (
    <div>
      <SessionRow
        kind="local"
        label="local"
        branch={project.git_info?.current_branch}
        isActive={localActive}
        ahead={localActive ? aheadBehind?.ahead : undefined}
        changes={localChanges}
        shortcut={shortcut}
        title="Open primary terminal"
        onClick={(e) => {
          e.stopPropagation();
          onSelectProject(project.id);
        }}
      />

      <WorktreeList
        worktrees={worktrees}
        projectId={project.id}
        projectPath={project.path}
        onOpenWorktreeTerminal={onOpenWorktreeTerminal}
        onRefreshGit={onRefreshGit}
        onShowToast={onShowToast}
      />
    </div>
  );
}

export default React.memo(ProjectGitSection);

import React from 'react';

import { UnitSessionList } from '@/features/live-sessions';
import SessionRow from '@/shared/components/SessionRow';
import { useSessionsByUnit } from '@/shared/hooks/useSessionsByUnit';
import { useUnitsWithActiveSession } from '@/shared/hooks/useUnitsWithActiveSession';
import { NO_SESSIONS, dominantState } from '@/shared/selectors/liveSessionSelectors';
import { useGitStore } from '@/shared/store/gitStore';
import { selectActiveCheckoutPath, useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { Project } from '@/shared/types';
import { ProjectId, WorkspaceSession } from '@/shared/utils/workspaceRef';

import WorktreeList from './WorktreeList';

interface ProjectGitSectionProps {
  project: Project;
  isActive: boolean;
  /** 由父级派生的 Ctrl+N shortcut（hover 时展示） */
  shortcut?: string;
  actions: {
    onSelectProject: (projectId: ProjectId) => void;
    onRefreshGit: (projectId: ProjectId) => void;
    onOpenWorktreeTerminal?: (projectId: ProjectId, worktreePath: string, branch: string) => void;
    onShowToast?: (message: string, type?: 'info' | 'error') => void;
  };
}

/**
 * ProjectGitSection — 渲染项目 group 展开后的 session 列表：
 * 1. 主终端行（"local"）；
 * 2. 每个 worktree 行（由 `WorktreeList` 负责，含 ↑N chip 与 trash/rename 控件）。
 */
function ProjectGitSection({ project, isActive, shortcut, actions }: ProjectGitSectionProps) {
  const { onSelectProject, onRefreshGit, onOpenWorktreeTerminal, onShowToast } = actions;

  const worktrees = project.git_info?.worktrees ?? [];
  // 响应式读取（渲染期读 `getState()` 会停在旧值：切回主仓时高亮不更新）
  const activeCheckoutPath = useWorkspaceStore((s) => selectActiveCheckoutPath(s, project.id));
  /** 主仓单元的键：本行显示的 ↑N 取主仓单元。 */
  const mainWorkspaceKey = WorkspaceSession.of(project.id, null).key;

  // local 主终端行的 ahead/behind 取**主仓单元**的键（旧实现的 `local:{projectId}` 键没有任何写
  // 入侧，于是徽标恒空）；该数字只在主仓视图（`localActive`）显示，与 worktree 的数字互不相关。
  const aheadBehind = useGitStore((s) => s.aheadBehind[mainWorkspaceKey]);

  // 单元角标与会话子列表都取自**同一份注册表快照**（视图不持有状态副本）。
  // 分组用共享的 `useSessionsByUnit`：与 worktree 行 / 会话子列表同一份实现。
  const unitSessions = useSessionsByUnit().get(mainWorkspaceKey) ?? NO_SESSIONS;
  // 子行被选中时父行不填充（选中样式只出现在最具体的一层）。
  const childActive = useUnitsWithActiveSession().has(mainWorkspaceKey);

  const localActive = isActive && !activeCheckoutPath;

  return (
    <div>
      <SessionRow
        kind="local"
        label="local"
        isActive={localActive}
        ahead={localActive ? aheadBehind?.ahead : undefined}
        shortcut={shortcut}
        title="Open primary terminal"
        status={dominantState(unitSessions)}
        childCount={unitSessions.length}
        childActive={childActive}
        onClick={(e) => {
          e.stopPropagation();
          onSelectProject(project.id);
        }}
      >
        {unitSessions.length > 0 ? (
          <UnitSessionList
            workspaceKey={mainWorkspaceKey}
            onRevealUnit={() => onSelectProject(project.id)}
          />
        ) : undefined}
      </SessionRow>

      <WorktreeList
        worktrees={worktrees}
        projectId={project.id}
        onOpenWorktreeTerminal={onOpenWorktreeTerminal}
        onRefreshGit={onRefreshGit}
        onShowToast={onShowToast}
      />
    </div>
  );
}

export default React.memo(ProjectGitSection);

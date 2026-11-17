import React, { useCallback } from 'react';

import { useTeamsByUnit } from '@/features/agent-team';
import { UnitSessionList } from '@/features/live-sessions';
import WorktreeRowList from '@/shared/components/WorktreeRowList';
import { useActiveWorkspace } from '@/shared/store/workspaceStore';
import { Worktree } from '@/shared/types';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { useWorktreeListActions } from '../hooks/useWorktreeListActions';

interface WorktreeListProps {
  worktrees: Worktree[];
  projectId: ProjectId;
  onOpenWorktreeTerminal?: (projectId: ProjectId, path: string, branch: string) => void;
  onRefreshGit: (projectId: ProjectId) => void;
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
}

/**
 * 本地项目卡的 linked worktree 行列表 —— **薄适配器**：把本地的域动作
 * （`useWorktreeListActions`：PTY 回收 + 删分支 + 槽位作废 + canonical 收口）接进
 * 共用的行渲染 [`WorktreeRowList`]。视觉与交互全在共用件里，本组件不含 JSX 结构。
 */
const WorktreeList: React.FC<WorktreeListProps> = ({
  worktrees,
  projectId,
  onOpenWorktreeTerminal,
  onRefreshGit,
  onShowToast,
}) => {
  const rowState = useWorktreeListActions(projectId, onRefreshGit, onShowToast);

  // 响应式订阅：这里读的是「哪一行高亮」，用 getState() 快照会在激活态变化后停在旧值
  // （列表看起来点了没反应）。命令式取法只允许出现在事件回调里。
  const activeCheckoutPath = useActiveWorkspace(projectId).activePath;

  // 单元的子项数除了会话还包括**团队行**（团队可以没有任何列出会话 —— 成员会话不进子列表）。
  // 分组口径在团队域（`teamsByUnit`），本组件只把结果交给共用行渲染。
  const teamsByUnit = useTeamsByUnit();
  const extraChildCount = useCallback(
    (workspaceKey: string) => teamsByUnit.get(workspaceKey)?.length ?? 0,
    [teamsByUnit],
  );

  return (
    <WorktreeRowList
      projectId={projectId}
      worktrees={worktrees}
      activeCheckoutPath={activeCheckoutPath}
      rowState={rowState}
      extraChildCount={extraChildCount}
      onOpenWorktreeTerminal={(path, branch) => onOpenWorktreeTerminal?.(projectId, path, branch)}
      renderUnitSessions={(workspaceKey, revealUnit) => (
        <UnitSessionList workspaceKey={workspaceKey} onRevealUnit={revealUnit} />
      )}
    />
  );
};

export default React.memo(WorktreeList);

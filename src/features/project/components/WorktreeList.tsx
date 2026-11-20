import React from 'react';

import { useTeamFreeWorktrees, useTeamRowSelected } from '@/features/agent-team';
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
 *
 * **哪些工作树该列出来**不在这里判：被团队占用的树在**冗余时**才不再作为地点行出现
 * （判据与边界见 `useTeamFreeWorktrees`）。主仓行不属于本列表，因此永不被过滤。
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

  // 团队占用的树交给团队行表达（展开即见成员），不再列一条同名的地点行。
  const visibleWorktrees = useTeamFreeWorktrees(projectId, worktrees);
  // 第二级的当前行是团队 ⇒ 本列表不让任何行自称当前（判据与团队行同一份派生）。
  const teamRowSelected = useTeamRowSelected(projectId);

  return (
    <WorktreeRowList
      projectId={projectId}
      worktrees={visibleWorktrees}
      activeCheckoutPath={activeCheckoutPath}
      suppressActive={teamRowSelected}
      rowState={rowState}
      onOpenWorktreeTerminal={(path, branch) => onOpenWorktreeTerminal?.(projectId, path, branch)}
      renderUnitSessions={(workspaceKey, revealUnit) => (
        <UnitSessionList workspaceKey={workspaceKey} onRevealUnit={revealUnit} />
      )}
    />
  );
};

export default React.memo(WorktreeList);

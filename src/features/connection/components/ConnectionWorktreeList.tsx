import React, { useCallback } from 'react';

import { useTeamsByUnit } from '@/features/agent-team';
import { UnitSessionList } from '@/features/live-sessions';
import WorktreeRowList from '@/shared/components/WorktreeRowList';
import { useWorktreeRowState } from '@/shared/hooks/useWorktreeRowState';
import type { Worktree } from '@/shared/types';
import type { ProjectId } from '@/shared/utils/workspaceRef';

interface ConnectionWorktreeListProps {
  /** 本列表所属项目 —— 状态槽位按 `WorkspaceSession.of(projectId, wt.path).key` 定址（与本地侧栏同一张表）。 */
  projectId: ProjectId;
  worktrees: Worktree[];
  /** 当前激活的 worktree 路径 */
  activeCheckoutPath: string | null;
  /** 点击 worktree 行：触发外部 onOpenWorktreeTerminal */
  onOpenWorktreeTerminal: (worktreePath: string, branch: string) => void;
  /** 双击 worktree label：开始重命名（提交 newName 由父级处理） */
  onCommitRenameWorktree: (oldPath: string, newName: string) => void;
  /** 删除 worktree（含分支） */
  onRemoveWorktree: (worktreePath: string, branch: string) => void;
  /** 检查 worktree 是否 dirty */
  onIsWorktreeDirty?: (worktreePath: string) => Promise<boolean>;
}

/**
 * WSL / SSH 侧栏的 worktree 行列表 —— **薄适配器**：把连接域的回调接进共用的行渲染
 * [`WorktreeRowList`]（同一 `SessionRow` / `useWorktreeRowState` / `InlineRenameInput` /
 * `DeleteConfirmDialog`）。本组件不含 JSX 结构。
 *
 * **刻意的差异只有一处**：删除后延迟 800ms 清 spinner。远端父级是**异步刷新**列表，
 * 删除命令返回时工作树尚未从清单消失，立即清 spinner 会让行「闪回」。
 */
const ConnectionWorktreeList: React.FC<ConnectionWorktreeListProps> = ({
  projectId,
  worktrees,
  activeCheckoutPath,
  onOpenWorktreeTerminal,
  onCommitRenameWorktree,
  onRemoveWorktree,
  onIsWorktreeDirty,
}) => {
  const rowState = useWorktreeRowState(
    onCommitRenameWorktree,
    onRemoveWorktree,
    onIsWorktreeDirty,
    800,
  );

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
      onOpenWorktreeTerminal={onOpenWorktreeTerminal}
      renderUnitSessions={(workspaceKey, revealUnit) => (
        <UnitSessionList workspaceKey={workspaceKey} onRevealUnit={revealUnit} />
      )}
    />
  );
};

export default React.memo(ConnectionWorktreeList);

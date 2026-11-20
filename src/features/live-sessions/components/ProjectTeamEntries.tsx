import React, { useMemo } from 'react';

import { ProjectTeamList, useTeamsOfProject } from '@/features/agent-team';
import type { Worktree } from '@/shared/types';
import type { TeamSummary } from '@/shared/types/team';
import { WorkspaceSession, type ProjectId, type WorkspaceKey } from '@/shared/utils/workspaceRef';

import { useTeamEntryActions } from '../hooks/useTeamEntryActions';

interface ProjectTeamEntriesProps {
  /** 本卡片所属项目 —— 团队按 `projectId` **相等**归属（不从路径猜）。 */
  projectId: ProjectId;
  /** 本项目现存的 `git worktree list` 行。传**清单本身**（不是 `map(path)`）：
   *  身份在这里一次铸好，同时在 memo 稳定引用上 —— 上游不必为每一层 `React.memo` 造新数组。 */
  worktrees: readonly Worktree[];
}

interface ProjectTeamBlockProps {
  teams: readonly TeamSummary[];
  /** 现存单元的 key 集合（R6 缺失判据的唯一输入）。 */
  worktreeKeys: ReadonlySet<WorkspaceKey>;
}

/**
 * 有团队时才挂载的那一半：终端侧的装配只在这里发生。
 *
 * 分两层是**前提**而不是风格：`useTeamEntryActions` 需要 `ProjectActionsProvider`（缺了
 * **抛错**，不静默降级），而「没有团队」是最常见的情形 —— 那时连这个 hook 都不该被调用，
 * 否则每一张无团队的项目卡都白付一次装配（也让不包 Provider 的宿主/用例直接炸）。
 */
const ProjectTeamBlock: React.FC<ProjectTeamBlockProps> = React.memo(
  ({ teams, worktreeKeys }: ProjectTeamBlockProps) => {
    const { onOpenLead, onOpenTeamPanel, onOpenMember } = useTeamEntryActions();

    return (
      <ProjectTeamList
        teams={teams}
        worktreeKeys={worktreeKeys}
        onOpenLead={onOpenLead}
        onOpenTeamPanel={onOpenTeamPanel}
        onOpenMember={onOpenMember}
      />
    );
  },
);
ProjectTeamBlock.displayName = 'ProjectTeamBlock';

/**
 * 项目层团队容器的**装配件**（没有团队时渲染 `null`）。
 *
 * # 为什么这里还需要一层（而不是宿主直接渲染 `ProjectTeamList`）
 *
 * `ProjectTeamList` 是团队域组件：它只产出「这行长什么样、点了要做什么」，**不认识**终端
 * 域与 dock 面板（同 `TeamPanel` 的分层）。接管 PTY / 切面板的能力是**宿主**的，由
 * `useTeamEntryActions` 绑定后注入 —— 与团队升到项目层之前的 `UnitSessionList` 装配
 * 完全同形。
 *
 * 项目 → 团队的分组口径也在这里消费（`useTeamsOfProject`），两个宿主不必各写一遍
 * `get(project.id) ?? []` 的空值处理 —— 顺序与空表语义只有一处。
 *
 * 这里也是「现存单元 = 身份集合」的**唯一铸造点**：`workspaceMissing`（R6）需要它，而
 * `shared/` 与 `agent-team` 都不该各自把路径拼一次（红线 12）。
 */
const ProjectTeamEntries: React.FC<ProjectTeamEntriesProps> = React.memo(
  ({ projectId, worktrees }: ProjectTeamEntriesProps) => {
    const teams = useTeamsOfProject().get(projectId);

    /**
     * 现存单元的 **key 集合**（不是在比路径）：与 `useTeamFreeWorktrees` / `teamUnitKeys`
     * 同一份 mint（`WorkspaceSession.of(...).key`），于是「同一棵树两种写法」不可表达。
     */
    const worktreeKeys = useMemo(
      () => new Set(worktrees.map((wt) => WorkspaceSession.of(projectId, wt.path).key)),
      [worktrees, projectId],
    );

    // 没有团队 ⇒ 整块不渲染（既有侧栏的零回归锚点：输出与容器模型之前逐字一致）。
    if (teams === undefined || teams.length === 0) return null;

    return <ProjectTeamBlock teams={teams} worktreeKeys={worktreeKeys} />;
  },
);
ProjectTeamEntries.displayName = 'ProjectTeamEntries';

export default ProjectTeamEntries;

import React from 'react';

import { useTeamRowSelected } from '@/features/agent-team';
import { ProjectTeamEntries, UnitSessionList } from '@/features/live-sessions';
import SessionRow from '@/shared/components/SessionRow';
import { useSessionsByUnit } from '@/shared/hooks/useSessionsByUnit';
import { useUnitsWithActiveSession } from '@/shared/hooks/useUnitsWithActiveSession';
import { NO_SESSIONS } from '@/shared/selectors/liveSessionSelectors';
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
 * ProjectGitSection — 渲染项目 group 展开后的二级列表：
 * 1. 主终端行（"local"）—— **地点**（单元）；
 * 2. 每个 worktree 行（由 `WorktreeList` 负责，含 ↑N chip 与 trash/rename 控件）—— 地点；
 * 3. 本项目下的**团队容器行**（`ProjectTeamEntries`）—— 容器，排在所有地点之后。
 *
 * 两种二级行的身份不同（见 design §2）：单元 = 「在这棵树里开终端」，团队 =「看那个队长在
 * 干什么」。团队必须在项目层：成员会话的归属由 `SessionAttribution` 回答，与它跑在哪棵树
 * 无关，挂在某棵单元下必然漏掉跑在别处的成员。
 *
 * 团队行与单元行**同构**（同一个 `SessionRow`，「这是团队」由行首的 `Users` 图标表达）；
 * 被团队占用的工作树不再作为第二条地点行出现（过滤在 `WorktreeList` 里）。
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
  // 子项数**只数会话**：团队升到项目层后不再是单元的子项（纯团队、无会话的单元因此可以
  // 折叠 —— 那是对的，团队不在那里了）。
  const childCount = unitSessions.length;
  // 子行被选中时父行不填充（选中样式只出现在最具体的一层）。
  const childActive = useUnitsWithActiveSession().has(mainWorkspaceKey);

  // 团队行是当前 ⇒ 本行让出高亮（第二级只有一行亮；判据与团队行同一份派生）。
  const teamRowSelected = useTeamRowSelected(project.id);
  const localActive = isActive && !activeCheckoutPath && !teamRowSelected;

  return (
    <div>
      <SessionRow
        kind="local"
        label="local"
        isActive={localActive}
        ahead={localActive ? aheadBehind?.ahead : undefined}
        shortcut={shortcut}
        title="Open primary terminal"
        childCount={childCount}
        childActive={childActive}
        onClick={(e) => {
          e.stopPropagation();
          onSelectProject(project.id);
        }}
      >
        {childCount > 0 ? (
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

      {/* 团队块追加在地点之后（地点在上、容器在下），没有团队时自己渲染 null。
          传 `worktrees` 本身（不是 `map(path)`）：派生在块内部 `useMemo`，否则每次父组件渲染
          都新建一个数组，三层 `React.memo` 全部失效。 */}
      <ProjectTeamEntries projectId={project.id} worktrees={worktrees} />
    </div>
  );
}

export default React.memo(ProjectGitSection);

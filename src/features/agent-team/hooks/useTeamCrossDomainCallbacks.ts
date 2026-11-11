import { useCallback } from 'react';

import type { TeamSession, TeamSnapshot } from '@/shared/types/team';
import type { ProjectId } from '@/shared/utils/workspaceRef';

/**
 * 把「团队事实」（`snapshot.team.projectId` / 团队名）接到**宿主注入的跨域动作**上。
 *
 * # 为什么单独成一个 hook
 *
 * 面板主体（列表 / 创建 / 团队视图的状态机）与「跨域回调怎么绑」是两条独立的变化理由：
 * 前者跟着导航模型演进，后者跟着终端 / 编辑器 / 会话域的接口演进。混在一个组件里，
 * 面板每次长一个新回调就要动主组件的 body —— 而主组件本该只关心视图切换。
 *
 * # projectId 的四个落键点必须同口径
 *
 * 「打开会话 / 看板 / 任务详情 / 历史会话」都按 `(projectId, 工作区)` 落键。团队的
 * projectId 是**团队行上的事实**（`team.projectId`），用激活项目顶替会把 tab 登记到
 * 另一棵树（症状很隐蔽：能连上、能显示，只有在关/恢复/分屏时才显形）。
 *
 * 空串 = v16 之前建的行，等价于「不知道」⇒ 投影成 `null`，由宿主回落激活项目。
 * 这个投影**只做一次**（`openTargetProjectId`），四个回调共用 —— 四处各写一遍就是
 * 四次漂移的机会。
 *
 * # 历史会话的回调是「绑定层」
 *
 * 花名册行 / 抽屉只认识成员（`MemberStatusView` 不含 teamProjectId），所以在这里把
 * teamProjectId 绑进去，下层签名保持三参不变。
 */
export interface TeamCrossDomainCallbacks {
  onOpenTerminal: (terminalId: string, title: string, agentId: string | undefined) => void;
  /** 任务详情（`TeamView` 的必填签名：三参，projectId 已绑好）。 */
  onOpenTask: (teamId: string, taskId: string, title: string) => void;
  onOpenBoard?: (view: 'board' | 'flow') => void;
  onOpenHistory?: (agentId: string, agentSessionId: string, title: string) => void;
  onOpenLeaderTerminal?: (session: TeamSession, title: string, agentId: string | undefined) => void;
}

export interface TeamCrossDomainHostProps {
  /** 当前打开的团队 id（`null` = 列表 / 创建态）。 */
  showingTeamId: string | null;
  snapshot: TeamSnapshot | null;
  /** 宿主注入的「打开会话」（四参：第三参 agentId，第四参团队自己的 projectId）。 */
  onOpenTerminal?: (
    terminalId: string,
    title: string,
    agentId: string | undefined,
    projectId: ProjectId | null,
  ) => void;
  onOpenBoard?: (
    teamId: string,
    teamName: string,
    projectId: ProjectId | null,
    view: 'board' | 'flow',
  ) => void;
  onOpenTaskTab?: (
    teamId: string,
    taskId: string,
    title: string,
    projectId: ProjectId | null,
  ) => void;
  onOpenHistory?: (
    agentId: string,
    agentSessionId: string,
    title: string,
    projectId: ProjectId | null,
  ) => void;
  onOpenLeaderTerminal?: (session: TeamSession, title: string, agentId: string | undefined) => void;
}

export function useTeamCrossDomainCallbacks(
  host: TeamCrossDomainHostProps,
): TeamCrossDomainCallbacks {
  const { showingTeamId, snapshot, onOpenTerminal, onOpenBoard, onOpenTaskTab } = host;
  const { onOpenHistory, onOpenLeaderTerminal } = host;

  /** 团队自己的项目；空串（历史行）→ `null`，由宿主回落激活项目。 */
  const teamProjectId = snapshot?.team.projectId ?? null;
  const openTargetProjectId = teamProjectId === '' ? null : teamProjectId;
  const teamName = snapshot?.team.name ?? null;

  const handleOpenTerminal = useCallback(
    (terminalId: string, title: string, agentId: string | undefined) => {
      // 未注入宿主回调时什么都不做（`noopOpenTerminal`）：花名册只需要一个必填三参签名。
      if (onOpenTerminal === undefined) return;
      onOpenTerminal(terminalId, title, agentId, openTargetProjectId);
    },
    [onOpenTerminal, openTargetProjectId],
  );

  const handleOpenBoard = useCallback(
    (view: 'board' | 'flow') => {
      if (showingTeamId === null) return;
      onOpenBoard?.(showingTeamId, teamName ?? showingTeamId, openTargetProjectId, view);
    },
    [showingTeamId, teamName, openTargetProjectId, onOpenBoard],
  );

  /**
   * 团队内导航：`TeamView` / `TeamTaskBoard` / `TeamFlowGraph` 都是**必填三参**
   * （它们不认识 projectId）。未注入宿主回调时是空实现 —— 与 `noopOpenTerminal`
   * 同一理由：少一条「可能 undefined」的分支。
   */
  const handleOpenTask = useCallback(
    (taskTeamId: string, taskId: string, title: string) => {
      // 任务详情 = 中央 tab（点开才拉，红线 4）。projectId 落键由 wrapper 注入。
      onOpenTaskTab?.(taskTeamId, taskId, title, openTargetProjectId);
    },
    [onOpenTaskTab, openTargetProjectId],
  );

  const handleOpenHistory = useCallback(
    (agentId: string, agentSessionId: string, title: string) => {
      onOpenHistory?.(agentId, agentSessionId, title, openTargetProjectId);
    },
    [onOpenHistory, openTargetProjectId],
  );

  const handleOpenLeaderTerminal = useCallback(
    (session: TeamSession, title: string, agentId: string | undefined) => {
      // **透传** `useStartTeam` 给的 agentId（取自建队响应的 `leadAgentId`）——
      // 那一刻快照可能还没落地，改用快照里的 lead 行会让 tab 先画成通用终端图标。
      onOpenLeaderTerminal?.(session, title, agentId);
    },
    [onOpenLeaderTerminal],
  );

  return {
    onOpenTerminal: handleOpenTerminal,
    onOpenTask: handleOpenTask,
    onOpenBoard: onOpenBoard ? handleOpenBoard : undefined,
    onOpenHistory: onOpenHistory ? handleOpenHistory : undefined,
    onOpenLeaderTerminal: onOpenLeaderTerminal ? handleOpenLeaderTerminal : undefined,
  };
}

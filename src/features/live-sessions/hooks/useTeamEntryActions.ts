import { useCallback } from 'react';

import { useTeamBoardTab } from '@/features/agent-team';
import { useTeamStore } from '@/features/agent-team/store/teamStore';
import { useTerminalTabs } from '@/features/terminal';
import { panelView } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { SessionView } from '@/shared/types/liveSessions';
import type { TeamSummary } from '@/shared/types/team';
import { WorkspaceSession, type ProjectId } from '@/shared/utils/workspaceRef';

/**
 * 侧栏**团队行**的三个动作（点击行 / 点击看板）。
 *
 * # 为什么在这里而不是在团队域组件里
 *
 * `features/agent-team` 迄今只认识 `@/features/agent` 一个域：终端接管、dock 面板切换、
 * 「接回上一次会话」都是**宿主**的能力。团队域只产出「这一行长什么样、点了要做什么」，
 * 能力的实现由宿主注入 —— 与 `TeamPanel`（回调注入）同一条分层，不新造一条反向依赖。
 *
 * 本文件是 `UnitSessionList` 的装配件（它本来就是 `features/live-sessions` 里唯一同时认识
 * 终端域与团队域门面的地方），于是 `UnitSessionList` 的 JSX 不必被三个 handler 淹没。
 *
 * # 顺序：先亮出单元，再激活 tab / 开面板
 *
 * 与 `useActivateSession` 同一顺序。反过来会在「tab 已切、视图还停在别处」之间留一帧白屏，
 * 而表现就是用户说的「点了没反应」。
 *
 * # 队长会话只**接管**，从不新建
 *
 * 活着的队长 PTY 由团队域持有，侧栏只把它渲染出来（`openExistingTerminalTab` 带
 * `attachSessionId`，不发 `create_terminal_session`，关 tab 也不杀进程）。不活的队长会话
 * 归 `team_resume`（它铸新的 terminal id 并重建团队配置）—— 在侧栏按会话重建会造出一个
 * **没有团队 MCP 端点 / 凭证 / 隔离配置目录**的裸 CLI。这条边界刻意留给团队面板的五态判据
 * （`utils/memberTerminal.ts`）：侧栏只回答「有没有活会话」。
 */
export interface TeamEntryActions {
  /** 有活队长会话 ⇒ 接管那条 PTY（不新建进程）。 */
  onOpenLead: (team: TeamSummary, session: SessionView) => void;
  /** 队长没有活会话 ⇒ 把团队面板切到该队，由花名册给出可行动作。 */
  onOpenTeamPanel: (team: TeamSummary) => void;
  /** 打开 / 激活该队的看板 tab（同队幂等）。 */
  onOpenBoard: (team: TeamSummary) => void;
}

/**
 * `TeamSummary.projectId` 是 wire 上的普通 `string`，而终端 / 看板 API 要 `ProjectId` 品牌。
 *
 * 铸型只在这一个边界（“入场铸型”，与 api wrapper 同一职责）：散到各调用点就是同一份身份
 * 的第二种表示，而品牌的意义正是让「谁铸的」可枚举。
 */
function teamProjectId(team: TeamSummary): ProjectId {
  return team.projectId as ProjectId;
}

/**
 * 把单元切到前台（项目激活态 + 单元激活态都归 `workspaceStore`）。
 *
 * 分量取自 `WorkspaceSession.of(...)`（唯一的单元身份铸造点，红线 12），不在调用侧自己拆
 * key / 拼 key。
 */
function revealUnit(team: TeamSummary): void {
  const unit = WorkspaceSession.of(team.projectId, team.workspaceWorktree);
  useWorkspaceStore.getState().setActiveWorkspace(unit.projectId, unit.worktreePath);
}

export function useTeamEntryActions(): TeamEntryActions {
  const { openExistingTerminalTab } = useTerminalTabs();
  const { openBoardTab } = useTeamBoardTab();

  const onOpenLead = useCallback(
    (team: TeamSummary, session: SessionView) => {
      // 先把单元亮出来，再接管 tab（见文件头「顺序」）。
      revealUnit(team);
      // 标题 / agent 都取自会话快照（唯一的会话事实源），不在这里编。
      openExistingTerminalTab(
        teamProjectId(team),
        session.sessionId,
        session.title,
        session.agentId,
      );
    },
    [openExistingTerminalTab],
  );

  const onOpenTeamPanel = useCallback((team: TeamSummary) => {
    revealUnit(team);
    // 面板的数据入口：`openTeam` 对同一个 id 幂等（已在看这个队时不打断、不闪空）。
    void useTeamStore.getState().openTeam(team.teamId);
    // 收起 / 在其他槽的面板也要真的出现在屏幕上：`activateView` 是唯一入口（含 Library 互斥）。
    useDockStore.getState().activateView(panelView('team'));
  }, []);

  const onOpenBoard = useCallback(
    (team: TeamSummary) => {
      // **也**先亮出单元（与另两个动作同一顺序）：`useTeamBoardTab` 按
      // `activeWorkspaceSession(projectId)` 落键，而那是「该项目**当前激活**的单元」——
      // 不先切的话，从一条**工作树**团队行点看板，tab 会落进主仓 / 另一个工作树的 tab 空间
      // （进程和数据显示都对，只是登记错位：关/恢复/分屏时才显形）。
      // 副作用是可预期的：你点了这个单元里的东西，这个单元就是你现在看的那个。
      revealUnit(team);
      // 落键 / 去重（按 teamId）/ 激活都在 `useTeamBoardTab` 一处：同队重复点击只是激活既有 tab。
      openBoardTab({
        teamId: team.teamId,
        teamName: team.name,
        projectId: teamProjectId(team),
        view: 'board',
      });
    },
    [openBoardTab],
  );

  return { onOpenLead, onOpenTeamPanel, onOpenBoard };
}

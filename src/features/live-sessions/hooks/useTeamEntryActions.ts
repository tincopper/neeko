import { useCallback } from 'react';

import { useTeamStore } from '@/features/agent-team/store/teamStore';
import { useTerminalTabs } from '@/features/terminal';
import { panelView } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import type { SessionView } from '@/shared/types/liveSessions';
import type { TeamSummary } from '@/shared/types/team';
import { WorkspaceSession, type ProjectId } from '@/shared/utils/workspaceRef';

import { useActivateUnit } from './useActivateUnit';

/**
 * 侧栏**团队行**的两个动作（点击行：接管活队长 / 交回团队面板）。
 *
 * # 为什么在这里而不是在团队域组件里
 *
 * `features/agent-team` 迄今只认识 `@/features/agent` 一个域：终端接管、dock 面板切换、
 * 「接回上一次会话」都是**宿主**的能力。团队域只产出「这一行长什么样、点了要做什么」，
 * 能力的实现由宿主注入 —— 与 `TeamPanel`（回调注入）同一条分层，不新造一条反向依赖。
 *
 * 本文件是 `UnitSessionList` 的装配件（它本来就是 `features/live-sessions` 里唯一同时认识
 * 终端域与团队域门面的地方），于是 `UnitSessionList` 的 JSX 不必被两个 handler 淹没。
 *
 * # 顺序：先「切项目 + 切单元」，再激活 tab / 开面板
 *
 * 与 `useActivateSession` 同一顺序，且判据只有一处：`utils/activateUnit`
 * （同项目零切换、单元在切换序列**结算之后**落回）。这里不再自己解释一遍 —— 两个动作都
 * 接在它的 Promise 之后，所以「先项目、后单元、再落 tab」对两者是同一条不变量。
 *
 * 每一个后续动作仍按**团队自己的** `projectId` 落键（不是「当前激活项目」）：
 * 团队属于哪个项目是团队的事实，不由「用户此刻在看哪个项目」决定。
 *
 * # 队长会话只**接管**，从不新建
 *
 * 活着的队长 PTY 由团队域持有，侧栏只把它渲染出来（`openExistingTerminalTab` 带
 * `attachSessionId`，不发 `create_terminal_session`，关 tab 也不杀进程）。不活的队长会话
 * 归 `team_resume`（它铸新的 terminal id 并重建团队配置）—— 在侧栏按会话重建会造出一个
 * **没有团队 MCP 端点 / 凭证 / 隔离配置目录**的裸 CLI。这条边界刻意留给团队面板的五态判据
 * （`utils/memberTerminal.ts`）：侧栏只回答「有没有活会话」。
 *
 * # 为什么没有「直接开看板」这个动作
 *
 * 侧栏曾经有一个行尾常驻的看板按钮（它带着一个只为本行服务的开 tab 回调）。团队行本身
 * 就是那个入口：面板里有看板，面板头上有「在中间打开」。侧栏再造一个快捷入口 = 同一个
 * 团队的第二块可点区域，且得在 260px 里挤掉队名。
 */
export interface TeamEntryActions {
  /** 有活队长会话 ⇒ 接管那条 PTY（不新建进程）。 */
  onOpenLead: (team: TeamSummary, session: SessionView) => void;
  /** 队长没有活会话 ⇒ 把团队面板切到该队，由花名册给出可行动作。 */
  onOpenTeamPanel: (team: TeamSummary) => void;
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
 * 团队行 → 它所属的**单元**（项目 + 工作树）。
 *
 * 分量经 `WorkspaceSession.of(...)` 铸（唯一的单元身份铸造点，红线 12），不在调用侧自己拆
 * key / 拼 key。
 */
function teamUnit(team: TeamSummary): WorkspaceSession {
  return WorkspaceSession.of(team.projectId, team.workspaceWorktree);
}

export function useTeamEntryActions(): TeamEntryActions {
  const { openExistingTerminalTab } = useTerminalTabs();
  const activateUnit = useActivateUnit();

  const onOpenLead = useCallback(
    (team: TeamSummary, session: SessionView) => {
      // 先切项目 + 切单元，再接管 tab（见文件头「顺序」）。
      void activateUnit(teamUnit(team)).then(() => {
        // 标题 / agent 都取自会话快照（唯一的会话事实源），不在这里编。
        openExistingTerminalTab(
          teamProjectId(team),
          session.sessionId,
          session.title,
          session.agentId,
        );
      });
    },
    [activateUnit, openExistingTerminalTab],
  );

  const onOpenTeamPanel = useCallback(
    (team: TeamSummary) => {
      void activateUnit(teamUnit(team)).then(() => {
        // 面板的数据入口：`openTeam` 对同一个 id 幂等（已在看这个队时不打断、不闪空）。
        void useTeamStore.getState().openTeam(team.teamId);
        // 收起 / 在其他槽的面板也要真的出现在屏幕上：`activateView` 是唯一入口（含 Library 互斥）。
        useDockStore.getState().activateView(panelView('team'));
      });
    },
    [activateUnit],
  );

  return { onOpenLead, onOpenTeamPanel };
}

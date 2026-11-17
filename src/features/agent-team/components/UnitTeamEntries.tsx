import { Users } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';

import { cn } from '@/lib/utils';
import { useActiveSessionRefs } from '@/shared/hooks/useActiveSessionRefs';
import { foregroundTeamId, isLiveSession } from '@/shared/selectors/liveSessionSelectors';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import type { SessionView } from '@/shared/types/liveSessions';
import type { TeamSummary } from '@/shared/types/team';

import { useTeamsByUnit } from '../hooks/useTeamsByUnit';
import { NO_TEAMS } from '../utils/teamList';

import TeamStateBadge from './TeamStateBadge';

/**
 * 单元下的**团队行**（身份 = 团队，不是某条 PTY）。
 *
 * # 为什么身份必须是团队（design §1）
 *
 * 团队行由 `team_list` 的一行派生，因此**队长进程死了、应用重启了，行仍在** —— 而那正是
 * 用户最需要入口的时刻。以「队长会话」为身份的方案（或「会话行 + 兜底团队行」的两身份方案）
 * 都有同一个致命面：最需要入口时刚好没有行；两身份还要处理「有会话时抑制团队行」的联动，
 * 而两条身份判据必然漂移。
 *
 * # 数据来源：两侧互不镜像（红线 17）
 *
 * | 事实 | 唯一来源 |
 * | --- | --- |
 * | 队名 / 状态 / 任务计数 | `team_list`（`useTeamsByUnit`） |
 * | 队长会话**活没活** / 它叫什么 | live-sessions 快照（`attribution` + `state`） |
 * | 「谁是队长」 | `TeamSummary.leadMemberId`（`team_member.role == lead` 的投影） |
 * | 「当前在哪」 | `foregroundTeamId`（前台 refs × 会话归属） |
 *
 * 「谁是队长」**不**来自会话归属：`SessionAttribution` 里刻意没有 `role`（那会让会话层持有
 * 一份会陈旧的队长身份）。这里做的是 `(teamId, memberId)` **求交**，两半各自读自己的真相源。
 *
 * # 两个动作，各只有一条路径（design §5）
 *
 * - 点击行：有活队长 ⇒ `onOpenLead`（接管那条 PTY，**不**新建进程）；否则 `onOpenTeamPanel`
 *   —— 侧栏**不**猜「为什么开不了」（未起过 / 已退出 / 已封存 / 可续接是花名册的五态判据，
 *   只有那一份实现）。重算一遍的错分后果是「以为在恢复，其实起了个没有团队 MCP 的裸 CLI」。
 * - 行尾按钮：`onOpenBoard`（看板 tab，同队幂等，由 `useTeamBoardTab` 保证）。
 *
 * 行上**没有**改名 / 删除：团队的生命周期在团队面板里，侧栏是入口不是第二套管理面。
 *
 * # 视觉（260px 列宽，design §7）
 *
 * ```text
 * [Users] 队名 · Running            2/5   [Board]
 *         Lead · <会话标题> / Lead not running
 * ```
 *
 * - 徽标复用 `TeamStateBadge`（不新造第三套状态词表）；
 * - 任务计数 `未终结/总数` 用 mono + `tabular-nums`（与会话行的相对时间同一档）；
 * - **不显示成员数**：`memberCount` 不含队长，而面板头也用它 —— 侧栏再写一次就成了同一个词
 *   的两个口径。人数留在面板头（唯一口径），本行放的是「还差几个活」（决策价值更高）；
 * - 看板按钮**常驻**（不做 hover 覆盖）：它是本任务的核心入口，藏起来就白做了。行主按钮与它
 *   是**兄弟**节点（同 `SessionListRow`），按钮不嵌套。
 */
export interface UnitTeamEntriesProps {
  /** 单元地址 key（`WorkspaceSession.key()`，与快照 / 团队行同一份身份）。 */
  workspaceKey: string;
  /** 接管**活着的**队长会话（不新建进程）。 */
  onOpenLead: (team: TeamSummary, session: SessionView) => void;
  /** 把团队面板切到该队（侧栏不知道「为什么开不了」，交回判据的宿主）。 */
  onOpenTeamPanel: (team: TeamSummary) => void;
  /** 打开 / 激活该队的看板 tab。 */
  onOpenBoard: (team: TeamSummary) => void;
}

/**
 * 该队**活着的**队长会话；`null` = 队长此刻没有进程。
 *
 * 三条判据都必须同时成立（缺一条就会把别的角色的会话当成队长）：
 * `teamMember` 归属 + `teamId` 相等 + `memberId === team.leadMemberId`；再叠 `isLiveSession`
 * （终止态不算「活着」——`isLiveSession` 是那条判据的唯一实现，这里不另写一份）。
 *
 * `leadMemberId === null`（该队没有队长行，数据缺陷）直接返回 `null`：没有队长行就没有
 * 可以求交的成员身份，猜不得。
 */
function liveLeadSession(team: TeamSummary, sessions: readonly SessionView[]): SessionView | null {
  const leadMemberId = team.leadMemberId;
  if (leadMemberId === null) return null;
  for (const session of sessions) {
    const attribution = session.attribution;
    if (attribution.kind !== 'teamMember') continue;
    if (attribution.teamId !== team.teamId) continue;
    if (attribution.memberId !== leadMemberId) continue;
    if (!isLiveSession(session)) continue;
    return session;
  }
  return null;
}

interface UnitTeamRowProps {
  team: TeamSummary;
  /** 活队长会话的标题；`null` = 队长未运行（副文案据此换一句话）。 */
  leadTitle: string | null;
  /** 前台正是这个队的某条会话（由 `foregroundTeamId` 单点派生，红线 17）。 */
  isCurrent: boolean;
  onOpen: (team: TeamSummary) => void;
  onOpenBoard: (team: TeamSummary) => void;
}

const UnitTeamRow: React.FC<UnitTeamRowProps> = React.memo(
  ({ team, leadTitle, isCurrent, onOpen, onOpenBoard }) => {
    const handleOpen = useCallback(() => onOpen(team), [onOpen, team]);
    const handleBoard = useCallback(() => onOpenBoard(team), [onOpenBoard, team]);

    const leadLine = leadTitle === null ? 'Lead not running' : `Lead · ${leadTitle}`;

    return (
      // 一行 = 「一个团队」。行主按钮是点击区，看板按钮是它的**兄弟**节点（按钮不嵌套）。
      <div
        role="listitem"
        data-team-id={team.teamId}
        className={cn(
          // 密度对齐会话子行（同档字号、同 radius / 内距）：「当前」由 `row-current` 一个语义类表达。
          'group/team relative flex w-full items-center gap-1 rounded-[5px] pl-2 pr-1.5 py-1 transition-colors',
          'hover:bg-bg-hover',
          isCurrent && 'row-current',
        )}
      >
        <button
          type="button"
          aria-current={isCurrent}
          className={cn(
            'flex min-w-0 flex-1 flex-col gap-0.5 text-left',
            'cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-blue',
          )}
          title={`${team.name}\n${leadLine}`}
          onClick={handleOpen}
        >
          <span className="flex w-full min-w-0 items-center gap-1.5">
            <Users size={13} aria-hidden="true" className="shrink-0 text-text-muted" />
            {/* 队名截断优先：状态徽标与任务计数都比名字短，名字该先让位。 */}
            <span className="min-w-0 flex-1 truncate text-[0.92em] text-text-primary">
              {team.name}
            </span>
            <TeamStateBadge state={team.state} />
            {/* 未终结/总数（已完成数进 title —— 窄侧栏里三个数字会换行，同 TeamListRow）。 */}
            <span
              className="shrink-0 font-mono text-[0.78em] text-text-muted tabular-nums"
              title={`${team.taskOpen} unresolved / ${team.taskTotal} total (${team.taskDone} done)`}
            >
              {`${team.taskOpen}/${team.taskTotal}`}
            </span>
          </span>
          {/* 副文案：队长会话标题（"lead 会话"可见性）或「队长未运行」。缩进对齐名字（图标 13 + gap 6）。 */}
          <span
            className={cn(
              'w-full truncate pl-[19px] text-[0.78em] text-text-muted',
              leadTitle === null && 'italic',
            )}
          >
            {leadLine}
          </span>
        </button>
        <button
          type="button"
          onClick={handleBoard}
          // 可访问名带队名：同一个面板里每行都有「Board」，读屏与测试都分不开。
          aria-label={`Open board for team ${team.name}`}
          title="Open the team board"
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[0.72em] text-text-muted transition-colors',
            'cursor-pointer hover:bg-bg-tertiary hover:text-text-primary',
            'focus-visible:outline-2 focus-visible:outline-accent-blue',
          )}
        >
          Board
        </button>
      </div>
    );
  },
);
UnitTeamRow.displayName = 'UnitTeamRow';

interface UnitTeamRowsProps extends Omit<UnitTeamEntriesProps, 'workspaceKey'> {
  teams: readonly TeamSummary[];
}

/**
 * 命中的团队才挂载的部分：会话快照 / 前台 refs 这两个订阅只在**真的有团队行要画**时建立。
 *
 * 分成两层（而不是在 `UnitTeamEntries` 里先订阅再早退）是为了让没有团队的单元（绝大多数）
 * 的订阅面与今天逐字一致：它们只多订阅一个 `teamListStore.list` 切片。
 */
const UnitTeamRows: React.FC<UnitTeamRowsProps> = React.memo(
  ({ teams, onOpenLead, onOpenTeamPanel, onOpenBoard }) => {
    const sessions = useLiveSessionsStore((s) => s.sessions);
    const refs = useActiveSessionRefs();

    // 「当前」的唯一派生：前台是哪条会话由 tab 布局说，它属于谁由快照的归属说（红线 17）。
    const currentTeamId = useMemo(() => foregroundTeamId(refs, sessions), [refs, sessions]);

    /** 每个队的活队长会话（一次 O(teams × sessions) 求交，行不再各扫一遍全表）。 */
    const leads = useMemo(
      () => new Map(teams.map((team) => [team.teamId, liveLeadSession(team, sessions)] as const)),
      [teams, sessions],
    );

    const handleOpen = useCallback(
      (team: TeamSummary) => {
        const lead = leads.get(team.teamId) ?? null;
        if (lead !== null) onOpenLead(team, lead);
        else onOpenTeamPanel(team);
      },
      [leads, onOpenLead, onOpenTeamPanel],
    );

    return (
      <div role="list" aria-label="Teams" className="flex flex-col gap-0.5 pb-0.5">
        {teams.map((team) => {
          const lead = leads.get(team.teamId) ?? null;
          return (
            <UnitTeamRow
              key={team.teamId}
              team={team}
              leadTitle={lead === null ? null : lead.title}
              isCurrent={team.teamId === currentTeamId}
              onOpen={handleOpen}
              onOpenBoard={onOpenBoard}
            />
          );
        })}
      </div>
    );
  },
);
UnitTeamRows.displayName = 'UnitTeamRows';

const UnitTeamEntries: React.FC<UnitTeamEntriesProps> = ({
  workspaceKey,
  onOpenLead,
  onOpenTeamPanel,
  onOpenBoard,
}) => {
  // 分组只此一处口径（`teamsByUnit`）：单元 key 相等即归属，不比路径前缀（红线 12）。
  const teams = useTeamsByUnit().get(workspaceKey) ?? NO_TEAMS;

  // 没有团队 ⇒ 什么都不渲染（既有侧栏的零回归锚点：无团队的单元输出与今天完全一致）。
  // 该单元不存在（项目未打开 / 工作树已删）时也走这一条 —— 不猜归属、不把团队挂到别处。
  if (teams.length === 0) return null;

  return (
    <UnitTeamRows
      teams={teams}
      onOpenLead={onOpenLead}
      onOpenTeamPanel={onOpenTeamPanel}
      onOpenBoard={onOpenBoard}
    />
  );
};

export default React.memo(UnitTeamEntries);

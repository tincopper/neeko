import React, { useCallback } from 'react';

import { cn } from '@/lib/utils';
import { isLiveSession, isNamedSession } from '@/shared/selectors/liveSessionSelectors';
import type { SessionView } from '@/shared/types/liveSessions';
import type { MemberStatusView } from '@/shared/types/team';

import { useTeamRoster } from '../hooks/useTeamRoster';
import { memberRoleLabel } from '../utils/memberBadge';
import { openTerminalAction } from '../utils/memberTerminal';

/**
 * 展开后的团队成员子行（R2）—— **花名册的全部成员**，含没有会话的那些。
 *
 * # 为什么成员来自花名册、而非会话
 *
 * 花名册是「这个队有哪些人」的唯一事实（`TeamSnapshot.members`，按队读取的缓存，见
 * `store/teamRosterStore`）。只列「有会话的成员」会漏掉两种真实状态：还没被派活的人、
 * 进程已退出的人 —— 而那正是用户想知道的「谁在跑」的另一半。
 *
 * # 会话怎么挂到成员上：与单元无关的一次求交
 *
 * `member.memberId` × `attribution(teamMember){teamId, memberId}`（`memberSessionsByTeam`）。
 * 两侧都是事实，不需要新 wire，也**不看** `workspaceKey` —— 成员跑在哪个单元与本行无关，
 * 这正是团队能成为跨单元容器的依据（成员空间扩张时这里一行都不用改）。
 *
 * # 队长排第一（`Lead` 标记）
 *
 * 团队行单行化之后折叠态不再有 `Lead · <标题>` 副文案，所以「谁是队长」必须在这里看得见：
 * 队长排第一、带 `Lead` 标记（文案来自 `memberRoleLabel`，与花名册 / 抽屉同一句），
 * 其余成员保持花名册顺序。排序在前端做是安全的：它只是**展示派生**（内部按 role 稳定
 * 分区），不建立第二份身份。
 *
 * # 能不能点：只有**活着的**会话能接管
 *
 * 侧栏的能力是「接管那条 PTY」（`onOpenMember` → `openExistingTerminalTab`），
 * 所以可点 ⟺ 快照里这个成员有一条活会话（`isLiveSession`，侧栏既有的唯一判活判据）。
 * 恢复（`team_resume`）与看历史记录都是面板的动作，侧栏**不**做 —— 在侧栏按会话重建会造出
 * 一个没有团队 MCP 端点 / 凭证 / 隔离配置目录的裸 CLI（`useTeamEntryActions` 的同一条边界）。
 *
 * 置灰时理由必须**可见**（不是只进 `title`）：`disabled` 元素不可聚焦，键盘与读屏用户拿不到
 * 它。理由来自花名册同一个判据点（`utils/memberTerminal::openTerminalAction`），本组件不
 * 重算五态。
 */
interface TeamMemberRowsProps {
  teamId: string;
  memberSessions: ReadonlyMap<string, SessionView> | undefined;
  onOpenMember: (session: SessionView) => void;
}

interface TeamMemberRowProps {
  member: MemberStatusView;
  /** 该成员在 live 快照里的会话（`null` = 一条都没有）。 */
  session: SessionView | null;
  onOpen: (session: SessionView) => void;
}

/**
 * 队长排第一，其余保持花名册顺序（稳定分区）。
 *
 * 不用 `Array#sort`：它要求比较函数对「两个都不是队长」返回 0 —— 依赖引擎稳定性来实现
 * 分区，读起来像巧合。这里只做一次两趟过滤，代价相同、意图显式。
 */
function leadFirst(members: readonly MemberStatusView[]): MemberStatusView[] {
  const lead = members.filter((member) => member.role === 'lead');
  const rest = members.filter((member) => member.role !== 'lead');
  return [...lead, ...rest];
}

/**
 * 成员行的第二行文案：`<会话标题>` / `running`（活着但还没真标题）/ 不可点的理由。
 *
 * 占位标题（`claude-code · neeko`）不是名字，印上去对用户毫无信息量，退成 `running` 而不是
 * 说谎（进程确实活着）—— 与侧栏其余部分同一条规则（占位串从不进侧栏）。
 *
 * 理由**不直接取 `action.reason`**：那条文案只在两档置灰时存在（`No session yet` / `Closed`），
 * 而「有原生会话记录、进程已退出」那两档是**可用**的（面板里能恢复 / 看历史），`reason` 为
 * `null` —— 回落到 `No session` 就会对着一份能读的历史说「没有会话」。所以按 `kind` 分派。
 */
function memberLine(member: MemberStatusView, session: SessionView | null): string {
  if (session === null) {
    const action = openTerminalAction(member);
    // 会话已结束但记录还在：侧栏不做恢复 / 读历史（那是面板的动作），只说清楚去哪打开。
    if (action.kind === 'resume') return 'Ended — resumable from the team panel';
    if (action.kind === 'archive') return 'Ended — history in the team panel';
    return action.reason ?? 'No session';
  }
  if (!isLiveSession(session)) {
    // 有记录但进程不在：侧栏不做恢复 / 读历史（那是面板的动作），只说清楚现在打不开。
    return 'No live session — open it from the team panel';
  }
  return isNamedSession(session) ? session.title : 'running';
}

const TeamMemberRow: React.FC<TeamMemberRowProps> = React.memo(
  ({ member, session, onOpen }: TeamMemberRowProps) => {
    const line = memberLine(member, session);
    // 可点 ⟺ 快照里有一条活会话（判活只有 `isLiveSession` 一份实现）。
    const enabled = session !== null && isLiveSession(session);
    const handleOpen = useCallback(() => {
      if (session === null || !isLiveSession(session)) return;
      onOpen(session);
    }, [onOpen, session]);

    const isLead = member.role === 'lead';
    // 名字行（两个分支共用）：名字吃剩余宽度并截断，`Lead` 标记 `shrink-0`。
    const nameLine = (nameClass: string): React.ReactNode => (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={cn('min-w-0 truncate', nameClass)}>{member.name}</span>
        {isLead ? (
          <span
            title="Lead: dispatches tasks and runs the board"
            className="shrink-0 rounded bg-accent-blue/10 px-1 text-micro font-semibold text-accent-blue"
          >
            {memberRoleLabel(member.role)}
          </span>
        ) : null}
      </span>
    );

    return (
      <div role="listitem" data-member-id={member.memberId} data-lead={isLead ? 'true' : undefined}>
        <div
          className={cn(
            'flex w-full min-w-0 flex-col gap-0.5 rounded-[5px] pl-2 pr-1.5 py-[3px] transition-colors',
            enabled && 'hover:bg-bg-hover',
          )}
        >
          {enabled ? (
            <button
              type="button"
              className={cn(
                'flex min-w-0 flex-col gap-0.5 text-left',
                'cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-blue',
              )}
              title={`${member.name}\n${line}`}
              onClick={handleOpen}
            >
              {nameLine('text-[0.88em] text-text-primary')}
              <span className="min-w-0 truncate text-[0.78em] text-text-muted">{line}</span>
            </button>
          ) : (
            // 不可点：理由作为**可见文字**（同 RosterRow 的口径），并用 `aria-disabled` 说明
            // 这不是省略了按钮，而是这条动作此刻不成立。
            <div aria-disabled="true" title={line} className="flex min-w-0 flex-col gap-0.5">
              {nameLine('text-[0.88em] text-text-secondary')}
              <span className="min-w-0 truncate text-[0.78em] text-text-muted italic">{line}</span>
            </div>
          )}
        </div>
      </div>
    );
  },
);
TeamMemberRow.displayName = 'TeamMemberRow';

const TeamMemberRows: React.FC<TeamMemberRowsProps> = React.memo(
  ({ teamId, memberSessions, onOpenMember }: TeamMemberRowsProps) => {
    // 本块只在展开时挂载 ⇒ 折叠态连 roster 的订阅都不建立（AC2 为零请求的结构性保证）。
    const roster = useTeamRoster(teamId);

    if (roster === null || (roster.loading && roster.members.length === 0)) {
      return <p className="px-2 py-0.5 text-[0.78em] text-text-muted">Loading roster…</p>;
    }
    // 失败但上一次成功的成员还在 ⇒ 继续显示成员（闪空比旧数据更糟），错误只在没有数据时占位。
    if (roster.error !== null && roster.members.length === 0) {
      return (
        <p role="alert" className="px-2 py-0.5 text-[0.78em] text-accent-red">
          {roster.error}
        </p>
      );
    }

    return (
      <div role="list" aria-label="Team members" className="flex flex-col gap-0.5">
        {leadFirst(roster.members).map((member) => (
          <TeamMemberRow
            key={member.memberId}
            member={member}
            session={memberSessions?.get(member.memberId) ?? null}
            onOpen={onOpenMember}
          />
        ))}
      </div>
    );
  },
);
TeamMemberRows.displayName = 'TeamMemberRows';

export default TeamMemberRows;

import { AlertTriangle } from 'lucide-react';
import React, { useCallback } from 'react';

import SessionRow from '@/shared/components/SessionRow';
import type { SessionView } from '@/shared/types/liveSessions';
import type { TeamSummary } from '@/shared/types/team';

import TeamMemberRows from './TeamMemberRows';

/**
 * 项目层的一个**团队容器行**（身份 = 团队，不是某条 PTY，也不是某棵树）。
 *
 * # 形状：第二级的**第三种行**，不是第三种实现
 *
 * 本组件是 `SessionRow kind="team"` 的**薄适配器**：行高 / 内距 / 行首图标位 / 行尾展开
 * 箭头 / 自动展开规则全部由 `SessionRow` 一份实现给出，与 `local` / `worktree` 行同构。
 * 曾经这里自绘两行结构（`⟦team⟧` + 队名 + 副文案 `Lead · <标题>`）并自带 `toggleExpanded`：
 * 那既让团队行看起来像另一个层级（用户反馈「把 team 和 local、worktree 并齐」），又把
 * 「展开」这个状态机造了第二份 —— 两份迟早漂移。
 *
 * 因此团队与单元的唯一区别落在两处**数据**上，而不是两套 JSX：
 *
 * | | 单元行 | 团队行 |
 * | --- | --- | --- |
 * | 行首图标 | `TerminalIcon` / `FolderGitIcon` | `Users`（与 Team dock 图标同源）|
 * | 右侧徽标 | （无） | 未终结/总数（**不显示状态文字**：见下）|
 *
 * # 为什么行由 `team_list` 派生
 *
 * 队长进程死了、应用重启了，行仍在 —— 而那正是用户最需要入口的时刻。以「队长会话」为身份
 * 的方案在最需要入口时刚好没有行。
 *
 * # 点击与展开是**两件事**，不是一个手势的两种结果
 *
 * | 区域 | 语义 |
 * | --- | --- |
 * | 行主体 | 有活队长 ⇒ 接管那条 PTY（`onOpenLead`）；否则把团队面板切到该队（`onOpenTeamPanel`）|
 * | 行尾箭头 | 就地展开成员（展开态归 `SessionRow`，**组件本地 state**）|
 *
 * 展开态刻意留在组件里：它是「我此刻想看这一队的成员」，不是团队的事实（写进 store 就成了
 * 第二个真相源，还要处理作废）。也**不**是 `teamStore.teamId` —— 那是「面板当前打开的队」，
 * 侧栏展开 A 队不该把面板切走（AC4）。
 *
 * # 折叠态不拉花名册
 *
 * 折叠行只用 `team_list`（队名 / 状态 / 任务计数 / 成员行数），成员子块整体只在展开时挂载
 * —— `TeamMemberRows` 内部才 `useTeamRoster`，所以折叠态连 roster 的订阅都不建立。成员
 * **名**只来自花名册，从会话的 `memberId`（`w1@tm_1`）拆名字是第二套身份解析（红线 12 同族）。
 *
 * # 队长信息在成员子行里，不在折叠行里
 *
 * 单行化之后副文案消失：队长排在成员列表第一位并带 `Lead` 标记（`TeamMemberRows`）。
 * 折叠行只留「未终结/总数」一枚计数 —— **没有状态文字**（用户裁决 2026-11-20：`open` /
 * `Closing` 这类词在 260px 列宽里要吃掉 40–60px，而它回答的问题只在点进去看时才成立）。
 *
 * # 团队空间缺失仍然渲染（R6）
 *
 * 容器不依赖那棵树还在不在：`workspaceWorktree` 已从 `git worktree list` 里消失时，行照旧
 * 出现并标注 —— 有活队长时点击仍能接管（进程可能在树被删之前就起来了）。
 */
export interface ProjectTeamRowProps {
  team: TeamSummary;
  /** 前台正是这个队的某条会话（由 `foregroundTeamId` 单点派生，红线 17）。 */
  isCurrent: boolean;
  /** 团队记的工作树已不在本项目的 `git worktree list` 里（后端字段比对，不做路径前缀）。 */
  workspaceMissing: boolean;
  /** 该队成员会话：`memberId → 会话`（跨单元求交，见 `memberSessionsByTeam`）。 */
  memberSessions: ReadonlyMap<string, SessionView> | undefined;
  onOpen: (team: TeamSummary) => void;
  onOpenMember: (session: SessionView) => void;
}

/**
 * 展开后的成员行数（`SessionRow` 的 `childCount`）。
 *
 * `TeamSummary.memberCount` 的后端口径是「**不含队长**、含已退出的成员」（同一个队只有这
 * 一个成员数，见 `types/team.ts`），而花名册含队长行 —— 所以这里把队长加回来，得到
 * 「展开后有多少行」。两个字段都是后端已经在 wire 上的事实：**不**从 `memberId` 拆名字，
 * 也不数为首拉花名册（折叠态零请求）。
 *
 * 用途只有一个：让团队行与单元行同一条展开规则 —— 首帧就展开有成员的队、成员增长时自动
 * 展开，用户的主动折叠被尊重（见 `SessionRow` 的 `childCount` 文档）。
 */
function memberRowCount(team: TeamSummary): number {
  return team.memberCount + (team.leadMemberId === null ? 0 : 1);
}

const ProjectTeamRow: React.FC<ProjectTeamRowProps> = React.memo(
  ({
    team,
    isCurrent,
    workspaceMissing,
    memberSessions,
    onOpen,
    onOpenMember,
  }: ProjectTeamRowProps) => {
    const handleOpen = useCallback(() => onOpen(team), [onOpen, team]);

    // 常驻徽标区（不是 `trailing`：那是 hover 覆盖槽，会盖住 label 尾巴）。
    // 队名截断优先 —— 计数比名字短，名字该先让位。
    //
    // **没有团队状态徽标**（用户裁决 2026-11-20）：「团队无需加上状态显示，特别这种文字的状态
    // 显示，很占用空间」。`open` / `Closing` 这类词在 260px 列宽里要吃掉 40–60px，而它回答的
    // 问题（这个队是不是还活着）在**点进去**看的时候才有意义 —— 面板头与团队列表页仍带着
    // `TeamStateBadge`（那里宽度够，且是用户主动看状态的地方）。侧栏这一行只留「还差几个活」。
    const labelBadge = (
      <>
        {/* 未终结/总数（已完成数进 title —— 窄侧栏里三个数字会换行，同 TeamListRow）。 */}
        <span
          className="shrink-0 font-mono text-[0.78em] text-text-muted tabular-nums"
          title={`${team.taskOpen} unresolved / ${team.taskTotal} total (${team.taskDone} done)`}
        >
          {`${team.taskOpen}/${team.taskTotal}`}
        </span>
        {/* 容器不依赖那棵树还在（R6），但缺失**不许静默** —— 用户会以为队长还在那个树里跑。
            用一枚**图标**而不是那句话（「workspace missing」在 260px 的行里要吃掉 100px 以上，
            而这是极端状态）：可见性靠字形 + 颜色，句子进 `aria-label` / `title`。
            与状态文字的差别在于它是**异常**，不是每一行都有的信息 —— 常驻文字才该删。 */}
        {workspaceMissing ? (
          <span
            data-testid="team-workspace-missing"
            aria-label="The worktree this team was started in is no longer in git worktree list"
            title="The worktree this team was started in is no longer in git worktree list"
            className="flex shrink-0 items-center text-accent-yellow"
          >
            <AlertTriangle size={11} aria-hidden="true" />
          </span>
        ) : null}
      </>
    );

    return (
      <div
        role="listitem"
        data-team-id={team.teamId}
        // 「当前」的稳定钩子（文案与 class 会随主题/语言变，属性不会）—— 同徽标的 `data-state`。
        data-current={isCurrent ? 'true' : undefined}
      >
        <SessionRow
          kind="team"
          label={team.name}
          title={team.name}
          isActive={isCurrent}
          labelBadge={labelBadge}
          childCount={memberRowCount(team)}
          // 首帧**不展开**：团队行的子项要发一次 `team_snapshot`（花名册），而单元行的子项
          // 就在内存里。有成员就自动展开会让侧栏每次挂载为每个队各拉一次花名册。
          defaultExpanded={false}
          childrenLabel="team members"
          onClick={handleOpen}
        >
          {/* 成员子行：**展开才挂载**（`SessionRow` 折叠时不渲染 children ⇒ 它内部才建立
              花名册订阅与请求）。缩进由 `SessionRow` 的 children 容器统一给。 */}
          <TeamMemberRows
            teamId={team.teamId}
            memberSessions={memberSessions}
            onOpenMember={onOpenMember}
          />
        </SessionRow>
      </div>
    );
  },
);
ProjectTeamRow.displayName = 'ProjectTeamRow';

export default ProjectTeamRow;

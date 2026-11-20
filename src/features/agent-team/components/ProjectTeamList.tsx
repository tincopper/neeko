import React, { useCallback, useMemo } from 'react';

import { isLiveSession, memberSessionsByTeam } from '@/shared/selectors/liveSessionSelectors';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import type { SessionView } from '@/shared/types/liveSessions';
import type { TeamSummary } from '@/shared/types/team';
import { WorkspaceSession, type WorkspaceKey } from '@/shared/utils/workspaceRef';

import { useCurrentTeamId } from '../hooks/useTeamRowCurrent';

import ProjectTeamRow from './ProjectTeamRow';

/**
 * 项目层第二级的**团队容器块**（`ProjectGitSection` / WSL·SSH 连接卡共用的唯一渲染点）。
 *
 * ```text
 * ▾ neeko
 *     ▾ local                     ← 地点（单元）
 *         ├ 我的会话 A
 *         └ 我的会话 B
 *     ▾ wt/feat-auth              ← 地点（单元）
 *     ▾ [Users] refactor 2/5          ← 容器（团队）：跨单元
 *         ├ lead [Lead] · 把任务板接上
 *         ├ w1 · 修登录竞态
 *         └ w2 · 还没有会话
 * ```
 *
 * 行内只有「未终结/总数」一枚计数：**状态文字不进侧栏**（用户裁决 2026-11-20），
 * 它回答的问题（这个队还活着吗）在点进去看时才成立 —— 面板头与团队列表页仍带那个徽标。
 *
 * 团队行与单元行**同构**（同一个 `SessionRow`）：「这是团队」由行首的 `Users` 图标表达，
 * 不再有 `⟦team⟧` 文字标记，也没有折叠态副文案 —— 队长信息在成员子行里（排第一、带
 * `Lead` 标记）。
 *
 * # 为什么团队必须在项目层（而不是任何一棵树下）
 *
 * 团队的成员会话归属由 `SessionAttribution`（`{kind:'teamMember', teamId, memberId}`）回答，
 * **与它跑在哪棵树无关**。挂在某棵单元树下就会漏掉跑在别的树里的成员；挂在每棵下则重复。
 * 容器是唯一随成员空间扩张（每人一棵树）之后仍然正确的形状。
 *
 * # 两侧互不镜像（红线 17）
 *
 * | 事实 | 唯一来源 |
 * | --- | --- |
 * | 队名 / 状态 / 任务计数 / 谁在工作树里 / 成员行数 | `team_list`（宿主经 `useTeamsOfProject` 传入）|
 * | 队长会话**活没活** | live 快照（`attribution` + `state`）|
 * | 「谁是队长」 | `TeamSummary.leadMemberId`（`team_member.role == lead` 的投影）|
 * | 「当前在哪一行」 | `currentTeamIdOf`（前台 refs × 会话归属 ∪ 点过的那一行）|
 * | 成员**名** | 花名册（展开时按队读取；本组件不碰）|
 *
 * 本组件不认识终端域、也不认识团队面板：两个动作由宿主注入（`useTeamEntryActions`），
 * 与 `TeamPanel` 同一分层。
 *
 * # 顺序：地点在上、团队在下
 *
 * 单元行顺序沿用今天（主 checkout → worktrees），团队块追加在其后，且只在有团队时出现
 * （宿主据此决定是否挂载本组件 —— 无团队的项目连这一行的订阅都不建立）。
 */
export interface ProjectTeamListProps {
  /** 本项目的全部团队（后端 `team_list` 的行，顺序即后端顺序）。 */
  teams: readonly TeamSummary[];
  /**
   * 本项目 `git worktree list` 里现存单元的 **key 集合**（`WorkspaceSession.key()`）—— R6
   * 缺失判据的唯一输入。
   *
   * 这里收**身份**而不是路径：本组件判定的是「团队的树还在不在」，与「哪些树被团队占用」
   * 是同一类判定（红线 12），两处都走 `WorkspaceSession.of(...).key` 的唯一 mint。
   *
   * 不新增 IPC：这个列表本来就随 `project.git_info` 到了前端，团队行只在已有数据里比对。
   */
  worktreeKeys: ReadonlySet<WorkspaceKey>;
  /** 有活队长会话 ⇒ 接管那条 PTY（不新建进程）。 */
  onOpenLead: (team: TeamSummary, session: SessionView) => void;
  /** 队长没有活会话 ⇒ 把团队面板切到该队（「为什么开不了」的判据在面板侧）。 */
  onOpenTeamPanel: (team: TeamSummary) => void;
  /** 成员行 ⇒ 接管该成员活着的会话（宿主负责先切到**该会话自己的**单元）。 */
  onOpenMember: (session: SessionView) => void;
}

/**
 * 该队**活着的**队长会话；`null` = 队长此刻没有进程。
 *
 * 三条判据必须同时成立（缺一条就会把别的角色的会话当成队长）：`teamMember` 归属 +
 * `teamId` 相等 + `memberId === team.leadMemberId`；再叠 `isLiveSession`。
 * `leadMemberId === null`（该队没有队长行，数据缺陷）直接 `null` —— 没有队长行就没有可求交
 * 的成员身份，猜不得。
 *
 * 它**只**用于点击分派（有活队长 ⇒ 接管那条 PTY）。折叠行不再显示队长副文案：单行化之后
 * 队长由展开后的成员子行表达（排第一 + `Lead` 标记）。
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

const ProjectTeamList: React.FC<ProjectTeamListProps> = React.memo(
  ({ teams, worktreeKeys, onOpenLead, onOpenTeamPanel, onOpenMember }: ProjectTeamListProps) => {
    const sessions = useLiveSessionsStore((s) => s.sessions);

    /**
     * 「当前」这一行（判据唯一实现在 `utils/teamRowSelection`，与单元行共用同一份）。
     *
     * 本组件**不**自己组合事实：团队行把前台会话与「点过哪一行」的和当「当前」，而单元行
     * 另算一遍，正是双亮 / 高亮消失两轮缺陷的成因（见 `currentTeamIdOf` 的文档）。
     */
    const currentTeamId = useCurrentTeamId(teams);

    /** 每个队的活队长会话（一次 O(teams × sessions) 求交，行不再各扫一遍全表）。 */
    const leads = useMemo(
      () => new Map(teams.map((team) => [team.teamId, liveLeadSession(team, sessions)] as const)),
      [teams, sessions],
    );

    /**
     * 成员会话：一次 O(sessions) 分组，只在展开时被消费（折叠态不读它也不请求花名册）。
     *
     * 与单元无关（只看归属）—— 这是容器模型的全部依据。
     */
    const memberSessions = useMemo(() => memberSessionsByTeam(sessions), [sessions]);

    const handleOpen = useCallback(
      (team: TeamSummary) => {
        const lead = leads.get(team.teamId) ?? null;
        // 有活队长 ⇒ 接管那条 PTY；否则交回面板（侧栏不猜「为什么开不了」）。
        if (lead !== null) onOpenLead(team, lead);
        else onOpenTeamPanel(team);
      },
      [leads, onOpenLead, onOpenTeamPanel],
    );

    return (
      <div role="list" aria-label="Teams" className="flex flex-col gap-0.5 pb-0.5">
        {teams.map((team) => (
          <ProjectTeamRow
            key={team.teamId}
            team={team}
            isCurrent={team.teamId === currentTeamId}
            // 缺失判据：团队的单元身份**不在**本项目的现存单元集合里（红线 12：同一份 mint）。
            // 主 checkout（`null`）不会「缺失」—— 它不在 worktree 列表里也仍然存在。
            workspaceMissing={
              team.workspaceWorktree !== null &&
              !worktreeKeys.has(WorkspaceSession.of(team.projectId, team.workspaceWorktree).key)
            }
            memberSessions={memberSessions.get(team.teamId)}
            onOpen={handleOpen}
            onOpenMember={onOpenMember}
          />
        ))}
      </div>
    );
  },
);
ProjectTeamList.displayName = 'ProjectTeamList';

export default ProjectTeamList;

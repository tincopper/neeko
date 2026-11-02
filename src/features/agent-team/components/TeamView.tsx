import React, { useCallback, useState } from 'react';

import type { TaskDetail, TeamRef, TeamSnapshot } from '@/shared/types/team';

import MemberDetailDrawer from './MemberDetailDrawer';
import TaskDetailDrawer from './TaskDetailDrawer';
import TeamHeader from './TeamHeader';
import TeamRoster from './TeamRoster';
import TeamTaskBoard from './TeamTaskBoard';

/**
 * 「已经打开的那个队」的视图：头部（见 [`TeamHeader`]）+ closing 横幅 + 花名册 + 任务板。
 *
 * # 单一真相
 *
 * 一切来自 `TeamSnapshot`（后端 `view.rs` 推导一次的产物）。这里**不缓存**成员状态、
 * 不派生「租约还剩多久」的时间流逝 —— 前端自己维护一份就会与快照漂移，而漂移是静默的。
 *
 * # `closing` 必须是一条横幅，不是一个徽标
 *
 * 「关到一半」意味着**成员进程还在跑**（有成员关不掉时后端整次 `team_close` 以 `Err` 结束，
 * 团队停在 `closing`）。这是本面板唯一会主动提示「再来一次」的状态：横幅上带
 * 「重试关闭」，走的是**同一条**关闭路径（同一次确认），不另开分支。
 *
 * # 「返回列表」不清 store
 *
 * 它是**导航**，不是关闭：`teamStore.teamId` 与快照都保留（视图切换由宿主持有）。
 *
 * # 成员详情抽屉的就近状态
 *
 * 「在开哪个成员」是**导航**（与 `TeamPanel` 的 `browsingFrom` 同族）：它不属团队状态、
 * 不进 store —— 成员详情是「点开一次才拉」的载荷（任务 + 50 条事件），而 store 里存的就是
 * “面板一直在看的那份快照”。放在本组件是因为花名册与抽屉的共同祖先就是这里：
 * 再往上放就会把「导航状态」和「数据面」接到同一个存储里，而它们的生命周期不同。
 */
interface TeamViewProps {
  /** 当前打开的团队（`teamStore.teamId`）。 */
  teamId: string;
  snapshot: TeamSnapshot | null;
  loading: boolean;
  /** `team_snapshot` 的失败原文。 */
  error: string | null;
  /** 点开的任务详情（`null` = 抽屉关闭）。 */
  detail: TaskDetail | null;
  /** 有关闭请求在飞（按钮置灰，避免连点）。 */
  closing: boolean;
  onRefresh: () => void;
  /** 回列表视图（**不清** store）。 */
  onBack: () => void;
  /** 请求关闭（二次确认由宿主弹）。 */
  onRequestClose: (team: TeamRef) => void;
  /** 打开某个成员的 PTY 终端（跨域动作，由 app 层 wrapper 注入）。 */
  onOpenTerminal: (terminalId: string, title: string) => void;
  /** 打开任务详情（`teamId` 在前：任务 id 只在队内唯一）。 */
  onOpenTask: (teamId: string, taskId: string) => void;
  onCloseTaskDetail: () => void;
}

const TeamView: React.FC<TeamViewProps> = React.memo(
  ({
    teamId,
    snapshot,
    loading,
    error,
    detail,
    closing,
    onRefresh,
    onBack,
    onRequestClose,
    onOpenTerminal,
    onOpenTask,
    onCloseTaskDetail,
  }) => {
    const teamName = snapshot?.team.name ?? teamId;
    /**
     * 正在看详情的成员（`null` = 抽屉关闭）。
     *
     * 与 `detail`（任务详情，在 store 里）的差别是**数据的归属**：任务正文是「点开一张卡片」
     * 的产物但面板要在换队时作废它，所以当初把它放进了 store；而成员详情自带
     * `memberId` 守卫（`useMemberDetail`），留在本组件更简单：卸载即消失。
     *
     * 存的是 `{ teamId, memberId }` 而不是单独一个 id：换队时抽屉自动失效（下面的
     * `showingMemberId`）。**不从 `memberId` 反解队** —— id 里虽然带 `@team` 后缀，
     * 但那是身份而不是导航事实（红线 12：不许从字符串拼/反解身份）。
     */
    const [openMember, setOpenMember] = useState<{ teamId: string; memberId: string } | null>(null);

    // 一个回调两处用（头部与横幅）：`TeamHeader` 是 memo 组件，内联箭头会让它每次重渲染。
    const handleRequestClose = useCallback(() => {
      onRequestClose({ teamId, name: teamName });
    }, [onRequestClose, teamId, teamName]);

    const handleOpenMember = useCallback(
      (memberId: string) => {
        // 一次只开一个抽屉：任务详情是底部面板、成员详情是右侧面板，两者同时开会在同一个
        // 坐标区重叠（窄的 dock 列里右面板会遮住底部面板的操作区）。开成员详情意味着
        // 用户换了关注对象，不是要两个一起看。
        onCloseTaskDetail();
        setOpenMember({ teamId, memberId });
      },
      [onCloseTaskDetail, teamId],
    );

    const handleCloseMember = useCallback(() => {
      setOpenMember(null);
    }, []);

    // 换队时抽屉自动失效（存的是打开那一刻的 `teamId`，不是从成员 id 反解的）。
    const showingMemberId =
      openMember !== null && openMember.teamId === teamId ? openMember.memberId : null;

    return (
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
        <TeamHeader
          teamId={teamId}
          snapshot={snapshot}
          closing={closing}
          onRefresh={onRefresh}
          onBack={onBack}
          onRequestClose={handleRequestClose}
        />

        {snapshot?.team.state === 'closing' ? (
          // 「关到一半」= 还有成员进程没关掉。这是本面板唯一主动提示「再来一次」的地方。
          <div
            role="status"
            className="flex items-center gap-2 border-b border-border bg-accent-orange/10 px-2 py-1"
          >
            <span className="min-w-0 flex-1 text-meta text-accent-orange">
              团队正在关闭，还有成员没关掉
            </span>
            <button
              type="button"
              onClick={handleRequestClose}
              disabled={closing}
              className="shrink-0 rounded px-1.5 py-0.5 text-micro font-semibold text-accent-orange hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-orange focus-visible:outline-none disabled:cursor-not-allowed disabled:text-text-muted"
            >
              重试关闭
            </button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="border-b border-border px-2 py-1 text-meta text-accent-red">
            {error}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto">
          {snapshot === null && loading ? (
            <p className="p-3 text-meta text-text-muted">正在加载团队快照…</p>
          ) : null}
          <TeamRoster
            members={snapshot?.members ?? []}
            onOpenTerminal={onOpenTerminal}
            onOpenMember={handleOpenMember}
          />
          <div className="border-t border-border" />
          <TeamTaskBoard
            tasks={snapshot?.tasks ?? []}
            members={snapshot?.members ?? []}
            tasksTruncated={snapshot?.tasksTruncated ?? false}
            onOpenTask={onOpenTask}
          />
        </div>

        {detail ? <TaskDetailDrawer detail={detail} onClose={onCloseTaskDetail} /> : null}
        {showingMemberId === null ? null : (
          <MemberDetailDrawer
            memberId={showingMemberId}
            onOpenTerminal={onOpenTerminal}
            onClose={handleCloseMember}
          />
        )}
      </div>
    );
  },
);
TeamView.displayName = 'TeamView';

export default TeamView;

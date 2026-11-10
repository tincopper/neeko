import { Maximize2 } from 'lucide-react';
import React, { useCallback, useState } from 'react';

import { cn } from '@/lib/utils';
import type { TeamRef, TeamSnapshot } from '@/shared/types/team';

import MemberDetailDrawer from './MemberDetailDrawer';
import TeamFlowGraph from './TeamFlowGraph';
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
  /** 有关闭请求在飞（按钮置灰，避免连点）。 */
  closing: boolean;
  onRefresh: () => void;
  /** 回列表视图（**不清** store）。 */
  onBack: () => void;
  /** 请求关闭（二次确认由宿主弹）。 */
  onRequestClose: (team: TeamRef) => void;
  /** 打开某个成员的 PTY 终端（跨域动作，由 app 层 wrapper 注入）。 */
  onOpenTerminal: (terminalId: string, title: string, agentId: string | undefined) => void;
  /**
   * 打开任务详情 = **中央 tab**（markdown 渲染；替代旧的底部抽屉）。
   * 三参（teamId, taskId, title）一起给 —— 标题用于 tab 标题（建 tab 时快照）。
   */
  onOpenTask: (teamId: string, taskId: string, title: string) => void;
  /**
   * 把当前任务视图（看板 / 分配图）作为**中央 tab**打开（300px 列装不下整张板）。
   * `undefined` = 宿主未注入跨域连线（按钮不渲染）。
   */
  onOpenBoard?: (view: 'board' | 'flow') => void;
  /** 打开已退出成员的历史会话（`conversation` tab）。 */
  onOpenHistory?: (agentId: string, agentSessionId: string, title: string) => void;
}

const TeamView: React.FC<TeamViewProps> = React.memo(
  ({
    teamId,
    snapshot,
    loading,
    error,
    closing,
    onRefresh,
    onBack,
    onRequestClose,
    onOpenTerminal,
    onOpenTask,
    onOpenBoard,
    onOpenHistory,
  }) => {
    const teamName = snapshot?.team.name ?? teamId;
    /**
     * 正在看详情的成员（`null` = 抽屉关闭）。
     *
     * （任务详情已改为中央 tab：点卡片 → `onOpenTask`，不再有 store 里的 detail。）
     * 存的是 `{ teamId, memberId }` 而不是单独一个 id：换队时抽屉自动失效（下面的
     * `showingMemberId`）。**不从 `memberId` 反解队** —— id 里虽然带 `@team` 后缀，
     * 但那是身份而不是导航事实（红线 12：不许从字符串拼/反解身份）。
     */
    const [openMember, setOpenMember] = useState<{ teamId: string; memberId: string } | null>(null);

    // 任务区的两种读法（看板 = 按状态分组；分配图 = 按 dependsOn 拓扑）。
    // 是**导航**（就近 state，不进 store）：它不改变快照，只改变同一份快照怎么画；
    // 换队时回到看板（两种读法对任何一个队都同样成立，没有「记住」的价值）。
    const [taskView, setTaskView] = useState<'board' | 'flow'>('board');

    // 一个回调两处用（头部与横幅）：`TeamHeader` 是 memo 组件，内联箭头会让它每次重渲染。
    const handleRequestClose = useCallback(() => {
      onRequestClose({ teamId, name: teamName });
    }, [onRequestClose, teamId, teamName]);

    const handleOpenMember = useCallback(
      (memberId: string) => {
        // 任务详情已改为中央 tab（不再有底部抽屉与它抢坐标区）。
        setOpenMember({ teamId, memberId });
      },
      [teamId],
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
            onOpenHistory={onOpenHistory}
          />
          <div className="border-t border-border" />
          <div className="flex items-center gap-1 px-2 pt-2">
            <span className="sr-only">任务区视图</span>
            {onOpenBoard ? (
              <button
                type="button"
                onClick={() => onOpenBoard(taskView)}
                aria-label="在中间区域打开任务视图"
                title="在中间区域打开（完整宽度）"
                className={cn(
                  'mr-auto grid size-5 place-items-center rounded text-text-muted',
                  'hover:bg-bg-hover hover:text-text-primary',
                  'focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
                )}
              >
                <Maximize2 size={12} aria-hidden="true" />
              </button>
            ) : null}
            {(
              [
                ['board', '看板'],
                ['flow', '分配图'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={taskView === value}
                onClick={() => setTaskView(value)}
                className={cn(
                  'rounded px-1.5 py-0.5 text-micro font-semibold',
                  taskView === value
                    ? 'bg-bg-selected text-accent-blue'
                    : 'text-text-muted hover:bg-bg-hover',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {taskView === 'board' ? (
            <TeamTaskBoard
              tasks={snapshot?.tasks ?? []}
              members={snapshot?.members ?? []}
              tasksTruncated={snapshot?.tasksTruncated ?? false}
              onOpenTask={onOpenTask}
            />
          ) : (
            <TeamFlowGraph
              tasks={snapshot?.tasks ?? []}
              members={snapshot?.members ?? []}
              onOpenTask={onOpenTask}
            />
          )}
        </div>

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

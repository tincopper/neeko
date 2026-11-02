import React, { useCallback } from 'react';

import { cn } from '@/lib/utils';
import type { TeamSnapshot } from '@/shared/types/team';

import { memberCountOf } from '../utils/memberCount';
import { awaitingApprovalCount } from '../utils/taskBoard';
import { projectRootTail } from '../utils/teamList';

import TeamStateBadge from './TeamStateBadge';

/**
 * 团队视图的头部：**一眼看清「哪个队、几个人、有几件事等人动手」**。
 *
 * | 元素 | 来源 |
 * | --- | --- |
 * | 队名 | `snapshot.team.name`（拉不到时退化成 teamId，不显示一个空白头）|
 * | 状态徽标 | `teamStateBadge`（三态，`closing` 不许并进 `active`）|
 * | `N 成员` | `memberCountOf(snapshot)`（**后端口径**：不含队长、含已退出的成员）|
 * | `M 待批` | `awaitingApprovalCount(snapshot.tasks)`（**只有 > 0 时出现**）|
 * | 「关闭团队」 | `closed` 时不存在（只读快照没有可关的东西，见 `TeamListRow` 同一判定）|
 *
 * # 为什么「M 待批」只在 > 0 时出现
 *
 * 「0 待批」是一条永远亮着的提示，读两次之后就不再读 —— 于是真有 1 条待批时也不会被看见。
 * 与「只显示前 N 条」同一条纪律：提示只在它成立时出现。
 *
 * # 项目根只摆末段
 *
 * 完整路径进 `title`：dock 右栏放不下绝对路径，而末段（分支 / 工作树目录名）才是用户在
 * 多个 worktree 之间区分团队的线索（同 `TeamListRow`）。
 */
interface TeamHeaderProps {
  /** 当前打开的团队（`teamStore.teamId`）。 */
  teamId: string;
  snapshot: TeamSnapshot | null;
  /** 有关闭请求在飞（按钮置灰，避免连点）。 */
  closing: boolean;
  onRefresh: () => void;
  /** 回列表视图（**不清** store）。 */
  onBack: () => void;
  onRequestClose: () => void;
}

const TeamHeader: React.FC<TeamHeaderProps> = React.memo(
  ({ teamId, snapshot, closing, onRefresh, onBack, onRequestClose }) => {
    const state = snapshot?.team.state ?? null;
    const teamName = snapshot?.team.name ?? teamId;
    // 成员数只有一份产出点（`utils/memberCount`）：列表行用后端的 `TeamSummary.memberCount`，
    // 这里用同一口径 —— 曾经这里是 `members.length`（含队长），于是同一个队在列表上「3」、
    // 点进去「4」。快照暂时没有这一列时由该函数从花名册派生一次（见其 TODO）。
    const memberCount = snapshot === null ? 0 : memberCountOf(snapshot);
    const awaiting = snapshot ? awaitingApprovalCount(snapshot.tasks) : 0;
    const projectPath = snapshot?.team.projectPath ?? teamId;

    const handleRequestClose = useCallback(() => onRequestClose(), [onRequestClose]);

    return (
      <header className="flex flex-col gap-1 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-ui font-semibold text-text-primary">
            {teamName}
          </span>
          {/* 徽标文案来自唯一映射点（`teamStateBadge`），不在这里另写一份 */}
          {state === null ? null : <TeamStateBadge state={state} />}
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 rounded px-1.5 py-0.5 text-micro text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
          >
            返回列表
          </button>
          <button
            type="button"
            onClick={onRefresh}
            aria-label="重新拉取团队快照"
            className="shrink-0 rounded px-1.5 py-0.5 text-micro text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
          >
            刷新
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-text-muted">
          <span className="rounded-full bg-bg-tertiary px-1.5 py-0.5 font-semibold">
            {`${memberCount} 成员`}
          </span>
          {awaiting > 0 ? (
            <span
              data-awaiting={awaiting}
              className="rounded-full bg-accent-yellow/10 px-1.5 py-0.5 font-semibold text-accent-yellow"
            >
              {`${awaiting} 待批`}
            </span>
          ) : null}
          <span className="min-w-0 truncate font-mono" title={projectPath}>
            {projectRootTail(projectPath)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {state === 'closed' ? (
            <span className="text-micro text-text-muted">只读快照：成员进程已退出</span>
          ) : (
            <button
              type="button"
              onClick={handleRequestClose}
              disabled={closing}
              className={cn(
                'rounded px-1.5 py-0.5 text-micro text-accent-red hover:bg-bg-hover',
                'focus-visible:ring-2 focus-visible:ring-accent-red focus-visible:outline-none',
                'disabled:cursor-not-allowed disabled:text-text-muted',
              )}
            >
              关闭团队
            </button>
          )}
        </div>
      </header>
    );
  },
);
TeamHeader.displayName = 'TeamHeader';

export default TeamHeader;

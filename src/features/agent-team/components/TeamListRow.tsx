import React, { useCallback } from 'react';

import type { TeamSummary } from '@/shared/types/team';

import { memberCountOf } from '../utils/memberCount';
import { formatCreatedAt, projectRootTail } from '../utils/teamList';

import TeamStateBadge from './TeamStateBadge';

/**
 * 团队列表的一行：名字 / 状态徽标 / 成员与任务数 / 项目根末段 / 创建时间 / 行操作。
 *
 * # 行操作由状态决定，不由前端「觉得还能用」决定
 *
 * | state | 操作 | 依据 |
 * | --- | --- | --- |
 * | `active` | 打开 + 关闭 | 成员进程还在，两个动作都成立 |
 * | `closing` | 打开 + 关闭 | **关到一半**：既要能看还剩谁，也要能重试关闭 |
 * | `closed` | 只有「查看」 | 已经没有可关的进程了；列一个「关闭」是给用户一个必然失败或什么都不做的按钮 |
 *
 * 「查看」与「打开」是同一个 `openTeam`，文案不同只因为**预期**不同：一个已关闭的队打开的
 * 是只读快照。
 *
 * # 数字全部来自载荷
 *
 * `memberCount` / `taskOpen` / `taskTotal` 都是后端算好的一行（列表里**没有**花名册与任务行，
 * 那正是 `team_list` 与 `team_snapshot` 分开的理由）。前端数不出这些数，也不该试着数。
 */
interface TeamListRowProps {
  team: TeamSummary;
  /** 打开（或只读查看）这个团队。 */
  onOpen: (teamId: string) => void;
  /** 请求关闭（二次确认由宿主弹，行内不做任何判定）。 */
  onRequestClose: (team: TeamSummary) => void;
}

const TeamListRow: React.FC<TeamListRowProps> = React.memo(({ team, onOpen, onRequestClose }) => {
  const { teamId, name, state } = team;
  const closed = state === 'closed';

  const handleOpen = useCallback(() => onOpen(teamId), [onOpen, teamId]);
  const handleClose = useCallback(() => onRequestClose(team), [onRequestClose, team]);

  const rootTail = projectRootTail(team.projectPath);

  return (
    <li
      data-team-id={teamId}
      className="flex flex-col gap-1 rounded-md border border-border bg-bg-secondary px-2 py-1.5"
    >
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-text-primary">
          {name}
        </span>
        <TeamStateBadge state={state} />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-text-muted">
        {/* 与面板头同一个产出点（`utils/memberCount`）：同一个队在两处不许有两个成员数 */}
        <span>{`成员 ${memberCountOf(team)}`}</span>
        <span aria-hidden="true">·</span>
        {/* `open/total`：未终结/总数（已完成数进 title —— 窄面板里三个数字会换行） */}
        <span title={`未终结 ${team.taskOpen} / 共 ${team.taskTotal}（已完成 ${team.taskDone}）`}>
          {`任务 ${team.taskOpen}/${team.taskTotal}`}
        </span>
        <span aria-hidden="true">·</span>
        {/* 只摆末段：完整路径进 title，信息没丢，只是默认不挤 */}
        <span className="min-w-0 truncate font-mono" title={team.projectPath}>
          {rootTail}
        </span>
        <span aria-hidden="true">·</span>
        <span title="建队时间">{formatCreatedAt(team.createdAt)}</span>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleOpen}
          // 行内按钮的可访问名必须带团队名：同一个面板里每行都有「打开」，读屏与测试都分不开。
          aria-label={`${closed ? '查看' : '打开'}团队 ${name}`}
          className="rounded px-1.5 py-0.5 text-micro text-accent-blue hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
        >
          {closed ? '查看' : '打开'}
        </button>
        {closed ? null : (
          <button
            type="button"
            onClick={handleClose}
            aria-label={`关闭团队 ${name}`}
            className="rounded px-1.5 py-0.5 text-micro text-accent-red hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-red focus-visible:outline-none"
          >
            关闭
          </button>
        )}
      </div>
    </li>
  );
});
TeamListRow.displayName = 'TeamListRow';

export default TeamListRow;

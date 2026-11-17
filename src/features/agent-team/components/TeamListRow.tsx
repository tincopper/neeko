import React, { useCallback, useState } from 'react';

import InlineRenameInput from '@/shared/components/InlineRenameInput';
import type { TeamRef, TeamSummary } from '@/shared/types/team';

import { memberCountOf } from '../utils/memberCount';
import { renameDraftCommit } from '../utils/renameDraft';
import { formatCreatedAt, projectRootTail } from '../utils/teamList';

import TeamStateBadge from './TeamStateBadge';

/**
 * 团队列表的一行：名字 / 状态徽标 / 成员与任务数 / 项目根末段 / 创建时间 / 行操作。
 *
 * # 行操作由状态决定，不由前端「觉得还能用」决定
 *
 * | state | 操作 | 依据 |
 * | --- | --- | --- |
 * | `open` | 打开 + 关闭 | 这个队可派活（进程在不在是另一件事），两个动作都成立 |
 * | `closing` | 打开 + 关闭 | **关到一半**：既要能看还剩谁，也要能重试关闭 |
 * | `sealed` | 查看 + **删除** | 用户已封存（不可恢复）；列一个「关闭」是给用户一个必然失败或什么都不做的按钮。而删除**只**在这里成立（后端 `delete_team` 只接受 `sealed`）|
 *
 * 「查看」与「打开」是同一个 `openTeam`，文案不同只因为**预期**不同：一个已封存的队打开的
 * 是只读快照。
 *
 * # 删除与关闭为什么不能是同一个按钮
 *
 * 关闭可重试（失败停在 `closing`）；删除不可逆（行 + 成员 + 任务 + 审计一起没）。两者共用
 * 一个按钮时，用户在 `closing` 行上就会碰到一个「按了以后后果不可逆」的动作，而它长得跟
 * 旁边那个「再来一次」一模一样。所以它们的**可见条件互斥**（`sealed` vs 非 `sealed`）。
 *
 * # 数字全部来自载荷
 *
 * `memberCount` / `taskOpen` / `taskTotal` 都是后端算好的一行（列表里**没有**花名册与任务行，
 * 那正是 `team_list` 与 `team_snapshot` 分开的理由）。前端数不出这些数，也不该试着数。
 *
 * # 改名是行内编辑，不是弹窗
 *
 * 入口是一个真按钮（不是双击隐藏手势）：键盘用户与读屏用户必须能「点」到它，而隐藏手势
 * 对他们等于不存在。点下去名字那一格换成 [`InlineRenameInput`]（共享件：Enter / Esc / blur
 * 三个键路与「点输入框不要冒泡成选中行」都在那份实现里）。
 *
 * **空名 / 没改 ⇒ 不发请求**：空名在后端是 `InvalidInput`（列表会出现一个点不中的空行），
 * 而没改就重写一遍只是白写一条审计。
 */
interface TeamListRowProps {
  team: TeamSummary;
  /** 打开（或只读查看）这个团队。 */
  onOpen: (teamId: string) => void;
  /** 请求关闭（二次确认由宿主弹，行内不做任何判定）。 */
  onRequestClose: (team: TeamRef) => void;
  /** 请求**删除**（同样只弹确认，不在这里判定；可删性由 `state === 'sealed'` 决定）。 */
  onRequestDelete: (team: TeamRef) => void;
  /**
   * 正在删哪个队（`null` = 没有删除在飞）。
   *
   * 收「正在删谁」而不是「是不是在删」：删除是**按队**的动作，删 A 的时候 B 的按钮不该
   * 变灰（`team_delete` 按 `team_id` 定位，两行之间没有共享状态）。判定落在本行
   * （`team.teamId === deletingTeamId`）—— 行自己知道自己的 id，这是最近的共同祖先。
   */
  deletingTeamId: string | null;
  /** 改名（宿主负责落地与失败处理；本行只提交一次「裁过的、且真的变了」的名字）。 */
  onRename: (teamId: string, name: string) => void;
}

const TeamListRow: React.FC<TeamListRowProps> = React.memo(
  ({ team, onOpen, onRequestClose, onRequestDelete, deletingTeamId, onRename }) => {
    const { teamId, name, state } = team;
    const sealed = state === 'sealed';
    // 只有**这一行**正在被删时按钮才置灰（见 `deletingTeamId` 的文档）。
    const deleting = teamId === deletingTeamId;

    /** `null` = 不在编辑态。编辑态的生命周期就是那个输入框的挂载期。 */
    const [draft, setDraft] = useState<string | null>(null);

    const handleOpen = useCallback(() => onOpen(teamId), [onOpen, teamId]);
    const handleClose = useCallback(() => onRequestClose(team), [onRequestClose, team]);
    const handleDelete = useCallback(() => onRequestDelete(team), [onRequestDelete, team]);
    const handleStartRename = useCallback(() => setDraft(name), [name]);
    const handleCancelRename = useCallback(() => setDraft(null), []);
    const handleCommitRename = useCallback(() => {
      if (draft === null) return;
      const next = renameDraftCommit(draft, name);
      setDraft(null);
      if (next === null) return;
      onRename(teamId, next);
    }, [draft, name, onRename, teamId]);

    const rootTail = projectRootTail(team.projectPath);

    return (
      <li
        data-team-id={teamId}
        className="flex flex-col gap-1 rounded-md border border-border bg-bg-primary px-2 py-1.5"
      >
        <div className="flex items-center gap-1.5">
          {draft === null ? (
            <span
              className="min-w-0 flex-1 truncate text-ui font-medium text-text-primary"
              // 双击改名：与侧栏会话行 / 工作树行同一手感（按钮仍是主入口）
              onDoubleClick={handleStartRename}
            >
              {name}
            </span>
          ) : (
            <InlineRenameInput
              value={draft}
              onChange={setDraft}
              onCommit={handleCommitRename}
              onCancel={handleCancelRename}
            />
          )}
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
            aria-label={`${sealed ? '查看' : '打开'}团队 ${name}`}
            className="rounded px-1.5 py-0.5 text-micro text-accent-blue hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
          >
            {sealed ? '查看' : '打开'}
          </button>
          {/* 改名在**任何状态**都成立：名字不参与任何判据（封存锁的是进程与恢复）。 */}
          <button
            type="button"
            onClick={handleStartRename}
            aria-label={`重命名团队 ${name}`}
            className="rounded px-1.5 py-0.5 text-micro text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
          >
            改名
          </button>
          {/* 关闭与删除**互斥**：可关的是还开着的队，可删的是已经封存的队。 */}
          {sealed ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              aria-label={`删除团队 ${name}`}
              className="rounded px-1.5 py-0.5 text-micro text-accent-red hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-red focus-visible:outline-none disabled:cursor-not-allowed disabled:text-text-muted"
            >
              删除
            </button>
          ) : (
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
  },
);
TeamListRow.displayName = 'TeamListRow';

export default TeamListRow;

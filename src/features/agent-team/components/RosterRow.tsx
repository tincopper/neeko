import React, { useCallback } from 'react';

import { cn } from '@/lib/utils';
import type { MemberStatusView } from '@/shared/types/team';

import { leaseText } from '../utils/leaseText';
import { memberRoleLabel } from '../utils/memberBadge';
import { memberChips } from '../utils/memberChips';
import { openTerminalAction } from '../utils/memberTerminal';

import Chip from './Chip';
import MemberAvatar from './MemberAvatar';
import MemberStateBadge from './MemberStateBadge';

/**
 * 花名册一行 = 一屏之内回答三件事：
 *
 * | 问题 | 字段 |
 * | --- | --- |
 * | 这是谁 | `memberId` → 头像色 / `name` + `agentId` chip + 档位 chip |
 * | 它在哪干活 | `workspace` chip（worktree 显示末段路径）|
 * | 它在等什么 | `state` + `verification` → 六态徽标；`leaseRemainingSecs` → 租约 |
 *
 * 三个派生输入（chip 文案 / 头像色 / 按钮判据）全部来自 `utils/` 的纯函数，这里只读结果。
 *
 * # 三个动作不许合并
 *
 * | 动作 | 目标 |
 * | --- | --- |
 * | 点行（主体那块） | 打开**成员详情抽屉**（`onOpenMember`）|
 * | 点按钮（`kind === 'live'`）| 直接接管它那个 PTY（`onOpenTerminal`）|
 * | 点按钮（`kind === 'resume'`）| 起一个**新进程**续接同一个原生会话（`onResumeMember` → `team_resume`）|
 * | 点按钮（`kind === 'archive'`）| 打开只读的历史记录（`onOpenHistory`）|
 *
 * 合并成一个动作就得选一个：只看详情 = 每次都要多点一次才能看到它在干什么；只开终端 =
 * 用户得自己在终端里翻 `team_task_list` 才知道它在等审批。两者是不同的问题。
 * 「恢复会话」与「查看记录」更不能合并：前者接管一个新进程（对话接着往下走），后者只读
 * 历史；合并后用户会得到「对话没有接着走」或「历史莫名被一个新的空会话顶掉」。
 *
 * # 为什么主体是一个 `<button>` 而不是 `div` + `onClick`
 *
 * 键盘用户与读屏用户必须能「点」到这一行。`role="group"` + `onClick` 的做法（配
 * `eslint-disable jsx-a11y/...`）在键盘上什么都不会发生，而「补一个 onKeyDown」只是让它
 * 看起来合规。用真按钮包住主体（头像 / 名字 / 徽标 / chips / 租约），终端按钮留在**同一行
 * 但不嵌套** —— 按钮不能包按钮，这是结构约束，不是选择。
 *
 * # 「打不开」必须带可见理由
 *
 * 没有活会话时按钮置灰，并把理由作为**可见文字**放在按钮旁边（`暂无会话` / `已关闭`）。
 * 只放 `title` 等于没有理由 —— `disabled` 元素不可聚焦，键盘与读屏用户拿不到它。
 * 判据同时作为点击守卫：置灰只是 UI，**零调用**是行为（[`openTerminalAction`]）。
 * 五态（活进程 / 可恢复 / 只看记录 / 两种置灰）文案见该函数的文档 —— 这里不重算任何一条。
 *
 * # 队长行不特殊对待
 *
 * 队长也是成员、也跑在自己的 PTY 里，所以打开会话的路径和成员完全一致，只多一枚「队长」
 * 标记（角色决定授权矩阵，不决定「能不能看它的终端」）。
 *
 * # 一行是一个有名的分组
 *
 * 读屏用户听到的是「成员 frontend」而不是一串徽标；测试也不必靠 `data-member-id` 抓 DOM
 * （可访问名就是稳定钩子）。`data-member-id` 保留给「机器要认人」的场景。
 */
interface RosterRowProps {
  member: MemberStatusView;
  /**
   * 打开某个成员的 PTY 终端（跨域动作，由 app 层 wrapper 注入）。
   *
   * 参数是**成员的** terminalId 与名字：标题用成员名，用户才能在 tab 上认出是谁。
   */
  onOpenTerminal: (terminalId: string, title: string, agentId: string | undefined) => void;
  /**
   * 打开**已退出成员的历史会话**（`conversation` tab，按 `agentId:nativeId`）。
   * 与 `onOpenTerminal` 是两条路：一个接管活进程，一个读磁盘记录。
   */
  onOpenHistory?: (agentId: string, agentSessionId: string, title: string) => void;
  /**
   * 恢复一个成员（`team_resume`，成员级）：起一个新进程续接**同一个**原生会话。
   *
   * `undefined` = 未注入（测试环境不动作），与 `onOpenHistory` 同一口径。
   */
  onResumeMember?: (memberId: string) => void;
  /** 打开这个成员的详情抽屉（点行的主体区域）。 */
  onOpenMember: (memberId: string) => void;
}

const RosterRow: React.FC<RosterRowProps> = React.memo(
  ({ member, onOpenTerminal, onOpenMember, onOpenHistory, onResumeMember }) => {
    const action = openTerminalAction(member);
    const chips = memberChips(member);
    const isLead = member.role === 'lead';
    // 句柄来自**同一份**判据输入（`session.terminalId` 只在 live 时非空）。
    const terminalId = member.session.terminalId;

    const handleOpenTerminal = useCallback(() => {
      if (!action.enabled) return;
      // 三条路（见 `openTerminalAction` 的五态表）：
      //   恢复 → 起一个新进程续接同一个会话（不带 terminalId：旧的已经不在了）；
      //   历史 → 读磁盘记录；
      //   活进程 → 接管那个 PTY。
      if (action.kind === 'resume') {
        onResumeMember?.(member.memberId);
        return;
      }
      if (action.kind === 'archive') {
        if (member.agentSessionId !== null && member.agentId !== undefined) {
          onOpenHistory?.(member.agentId, member.agentSessionId, member.name);
        }
        return;
      }
      // 置灰是 UI，**零调用**是行为：`null` 时连回调都不碰（否则宿主会去开一个不存在的会话）。
      if (terminalId === null) return;
      onOpenTerminal(terminalId, member.name, member.agentId);
    }, [action, onOpenTerminal, onOpenHistory, onResumeMember, member, terminalId]);

    const handleOpenDetail = useCallback(() => {
      onOpenMember(member.memberId);
    }, [member.memberId, onOpenMember]);

    return (
      <li data-member-id={member.memberId} data-lead={isLead ? 'true' : undefined}>
        <div
          role="group"
          aria-label={`成员 ${member.name}`}
          className={cn(
            'flex items-start gap-1.5 rounded-md border bg-bg-primary',
            isLead ? 'border-accent-blue/40' : 'border-border',
          )}
        >
          {/* 点行 = 看详情（主体块）；终端按钮在同一行但**不嵌套**在这里面 */}
          <button
            type="button"
            onClick={handleOpenDetail}
            aria-label={`查看成员 ${member.name} 的详情`}
            className="flex min-w-0 flex-1 flex-col gap-1 rounded-md px-2 py-1.5 text-left hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
          >
            <div className="flex items-center gap-1.5">
              <MemberAvatar
                memberId={member.memberId}
                name={member.name}
                agentId={member.agentId}
              />
              <span className="min-w-0 flex-1 truncate text-ui font-semibold text-text-primary">
                {member.name}
              </span>
              {isLead ? (
                <span className="shrink-0 rounded bg-accent-blue/10 px-1 text-micro font-semibold text-accent-blue">
                  {memberRoleLabel(member.role)}
                </span>
              ) : null}
              <MemberStateBadge member={member} />
            </div>

            <div className="flex flex-wrap items-center gap-1">
              {chips.map((chip) => (
                <Chip key={chip.key} tone={chip.tone} title={chip.title}>
                  {chip.text}
                </Chip>
              ))}
            </div>

            {/*
              花名册的租约是**快照值**（随脉冲更新，两脉冲之间数字不动）；卡片 / 抽屉是实时值。
              文案函数只有一份（`utils/leaseText`），所以两处的三态与格式一致。
              `null`（无在飞任务）/ `<=0`（已超时）/ `>0`（剩余）三态文案不同。
            */}
            <span className="min-w-0 truncate text-micro text-text-muted">
              {leaseText(member.leaseRemainingSecs).text}
            </span>
          </button>

          <div className="flex shrink-0 flex-col items-end gap-0.5 py-1.5 pr-2">
            {/* 置灰时理由以**可见文字**贴在按钮上方：`disabled` 元素不可聚焦，title 等于没有 */}
            {action.reason === null ? null : (
              <span className="text-micro text-text-muted">{action.reason}</span>
            )}
            <button
              type="button"
              onClick={handleOpenTerminal}
              disabled={!action.enabled}
              aria-label={`${action.label}：${member.name}`}
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-micro font-semibold',
                'text-accent-blue hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
                'disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-transparent',
              )}
            >
              {action.label}
            </button>
          </div>
        </div>
      </li>
    );
  },
);
RosterRow.displayName = 'RosterRow';

export default RosterRow;

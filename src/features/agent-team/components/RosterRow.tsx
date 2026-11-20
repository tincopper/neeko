import { History, Play, Terminal } from 'lucide-react';
import React, { useCallback } from 'react';

import { cn } from '@/lib/utils';
import type { MemberStatusView } from '@/shared/types/team';

import { leaseText } from '../utils/leaseText';
import { memberRoleLabel } from '../utils/memberBadge';
import { memberRowMeta, personaChipTitle } from '../utils/memberChips';
import { openTerminalAction } from '../utils/memberTerminal';

import Chip from './Chip';
import MemberAvatar from './MemberAvatar';
import MemberStateBadge from './MemberStateBadge';

/**
 * 花名册一行 = 一条卡片里两行内容，回答三件事（R13/R14 后的口径）：
 *
 * | 问题 | 字段 |
 * | --- | --- |
 * | 这是谁 | 头像 + 名字 + 队长标记 + persona（`null` 不占位）+ `⚠ C` + 六态徽标 |
 * | 它在哪干活 / 还要多久 | 非缺省工作区末段 + 租约（`null` 时**不渲染**）|
 *
 * agent / 通道 / 档位**不在行内**：它们是「能力边界」，低频且长，住成员详情抽屉
 * （`MemberDetailDrawer` 用同一张 `memberChips` 表）。行内只读 [`memberRowMeta`]。
 *
 * # 为什么是卡片（border + bg-primary）而不是裸列表
 *
 * 同一屏上「一条成员」得先看得出是**一条**。裸列表在 280px 下变成一片文字，用户反馈
 * 「还没有老一版的好看」—— 老一版的读感来自卡片外壳，不来自把 chip 堆回去（R13）。
 * 外壳是岛内卡片：`bg-bg-primary` + `border`，与所在分区不同色（表面层级契约）。
 *
 * # 红线 14 的两处承载（缺一即违规）
 *
 * C 档成员在行内有 `⚠ C` 这枚**可见文字**徽标（`title` 带完整句），同时 `TeamRoster`
 * 的分区底部常显那句「卡住永远不可知」。缩成颜色或只留 `title` 都算降级。
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
 * 看起来合规。用真按钮包住主体（头像 / 名字 / `⚠ C` / 徽标 / 工作区 · 租约），终端按钮留在
 * **同一行但不嵌套** —— 按钮不能包按钮，这是结构约束，不是选择。
 *
 * # 「打不开」必须带可见理由
 *
 * 没有活会话时按钮置灰，并把理由作为**可见文字**放在按钮旁边（`暂无会话` / `已关闭`）。
 * 只放 `title` 等于没有理由 —— `disabled` 元素不可聚焦，键盘与读屏用户拿不到它。
 * 判据同时作为点击守卫：置灰只是 UI，**零调用**是行为（[`openTerminalAction`]）。
 * 五态（活进程 / 可恢复 / 只看记录 / 两种置灰）文案见该函数的文档 —— 这里不重算任何一条。
 *
 * # 工具栏用图标（R15）
 *
 * 按钮本体是 `Terminal` / `Play` / `History`（按 `action.kind` 选），不再占一个词宽：
 * 五态文案落在 `aria-label` / `title`（可访问名仍是 `${label}：${name}`），置灰理由仍是
 * 图标旁的**可见文字**。图标化不许把理由搬到 `title` 里 —— 那等于删了它。
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
    const rowMeta = memberRowMeta(member);
    const isLead = member.role === 'lead';
    // 一个动作一个图标（R15）：三态是同一条路的不同分支，图标只表达「这条路通向什么」，
    // 文案仍在 `aria-label` / `title`（两处都不许省，置灰时读屏只剩 aria-label）。
    const ActionIcon =
      action.kind === 'resume' ? Play : action.kind === 'archive' ? History : Terminal;
    // R3：`leaseRemainingSecs === null` = 没有在飞任务 ⇒ **不渲染**租约文案。
    // 早先恒亮一句「无在飞任务」，于是最常见的行（没活的人）每行都多一行灰字。
    const lease = member.leaseRemainingSecs === null ? null : leaseText(member.leaseRemainingSecs);
    // 第二行只有「在哪干活 / 还要多久」两个可变事实；两者都没有时整行不渲染。
    const hasSubline = rowMeta.workspace !== null || lease !== null;
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
          aria-label={`Member ${member.name}`}
          className={cn(
            'flex items-center gap-1 rounded-md border bg-bg-primary',
            isLead ? 'border-accent-blue/45' : 'border-border',
          )}
        >
          {/* 点行 = 看详情（主体块）；终端按钮在同一行但**不嵌套**在这里面 */}
          <button
            type="button"
            onClick={handleOpenDetail}
            aria-label={`View member ${member.name} details`}
            className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-1.5 py-1 text-left hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <MemberAvatar
                memberId={member.memberId}
                name={member.name}
                agentId={member.agentId}
              />
              {/* 名字吃掉剩余宽度并截断；徽标与按钮 `shrink-0`，260px 下先压名字而不是压徽标 */}
              <span className="min-w-0 flex-1 truncate text-ui font-semibold text-text-primary">
                {member.name}
              </span>
              {isLead ? (
                <span className="shrink-0 rounded bg-accent-blue/10 px-1 text-micro font-semibold text-accent-blue">
                  {memberRoleLabel(member.role)}
                </span>
              ) : null}
              {rowMeta.persona === null ? null : (
                // R14：角色 / 人设回到行内（与抽屉那枚 chip 同一句话的 title，不另写一份）
                <Chip tone="accent" title={personaChipTitle(rowMeta.persona)}>
                  {rowMeta.persona}
                </Chip>
              )}
              {rowMeta.sentinelOnly ? (
                // 红线 14 的行内承载：可见文字 + 完整句在 title
                <span
                  title="Tier C · sentinel only: completion is reported, but a stall is never visible"
                  className="shrink-0 rounded border border-accent-yellow px-1 text-micro font-semibold text-accent-yellow"
                >
                  ⚠ C
                </span>
              ) : null}
              <MemberStateBadge member={member} />
            </span>

            {hasSubline ? (
              /*
                第二行只有两个可变事实：非缺省工作区（末段）+ 租约。
                租约是**快照值**（随脉冲更新，两脉冲之间数字不动），文案函数只有一份
                （`utils/leaseText`），所以与卡片 / 抽屉的两态与格式一致；`null` 时这一行不渲染。
              */
              <span className="flex min-w-0 items-center gap-1 text-micro text-text-muted">
                {rowMeta.workspace === null ? null : (
                  <span className="min-w-0 truncate">{rowMeta.workspace}</span>
                )}
                {rowMeta.workspace !== null && lease !== null ? (
                  <span aria-hidden="true">·</span>
                ) : null}
                {lease === null ? null : (
                  <span
                    data-urgent={lease.urgent ? 'true' : undefined}
                    className={cn(
                      'shrink-0 whitespace-nowrap',
                      lease.urgent && 'font-semibold text-accent-yellow',
                    )}
                  >
                    {lease.text}
                  </span>
                )}
              </span>
            ) : null}
          </button>

          <div className="flex shrink-0 items-center gap-1 pr-1.5">
            {/* 置灰时理由以**可见文字**贴在图标旁：`disabled` 元素不可聚焦，title 等于没有 */}
            {action.reason === null ? null : (
              <span className="text-micro text-text-muted">{action.reason}</span>
            )}
            <button
              type="button"
              onClick={handleOpenTerminal}
              disabled={!action.enabled}
              aria-label={`${action.label}: ${member.name}`}
              title={action.label}
              className={cn(
                'grid size-5 shrink-0 place-items-center rounded',
                'text-accent-blue hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
                'disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-transparent',
              )}
            >
              <ActionIcon size={12} aria-hidden="true" />
            </button>
          </div>
        </div>
      </li>
    );
  },
);
RosterRow.displayName = 'RosterRow';

export default RosterRow;

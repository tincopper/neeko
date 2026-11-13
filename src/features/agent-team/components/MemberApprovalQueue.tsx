import React, { useCallback } from 'react';

import { cn } from '@/lib/utils';
import type { MemberStatusView, TaskCard } from '@/shared/types/team';

import { openTerminalAction } from '../utils/memberTerminal';
import { taskStateLabel } from '../utils/taskBoard';

/**
 * AC5 的**待批队列**（design §6.1）：成员在等审批的任务，置顶在抽屉里。
 *
 * # 为什么必须写「不代批」
 *
 * 审批发生在**成员自己的终端里**（Claude Code / codex 一类的 TUI 审批框）：Neeko 既没有
 * 反向推送通道，也没有替用户按键的权限。若只列一行「待批准」，用户的第一反应是在面板上
 * 找批准按钮 —— 找不到就以为坏了。所以每一行都直说：**去它自己的终端处理**。
 *
 * 这同时是「不冒泡进队长对话」的另一半：审批请求进队列、**不进**队长的对话流，否则队长会
 * 拿自己的上下文去转述一句「它在等人按键」，而那句话对用户毫无信息量。
 *
 * # 空队列不渲染
 *
 * 一块永远存在、平时写「暂无待批」的面板，三次之后用户就不再读它 —— 真有东西时也一起忽略。
 * 判据（`awaiting_approval` 非空才出现）因此是**行为**，不是样式：空数组时本组件返回 `null`。
 *
 * # 与花名册同一判据（五态）
 *
 * 「去终端处理」的目标就是成员自己的终端，所以它的可用性来自同一份 `openTerminalAction`：
 * 进程在 ⇒ 接管 PTY；可恢复 ⇒ 先 `team_resume` 把对话接回来（绝不静默地跳去读历史 —— 那样
 * 用户会以为审批框在一个已经不存在的进程里）；只能看记录 ⇒ **置灰**并写出理由（历史里没有
 * 审批框，可点却什么都不发生比置灰更糟）。
 */
interface MemberApprovalQueueProps {
  /** AC5 队列（后端已经按 `state === awaiting_approval` 且 `owner === 该成员` 过滤）。 */
  tasks: readonly TaskCard[];
  /** 成员行 —— 「去终端处理」的可用性与理由都从它派生（`openTerminalAction`）。 */
  member: Pick<
    MemberStatusView,
    'memberId' | 'session' | 'name' | 'agentId' | 'agentSessionId' | 'sealed' | 'resumable'
  >;
  onOpenTerminal: (terminalId: string, title: string, agentId: string | undefined) => void;
  /** 恢复这个成员（`team_resume`，成员级）；`undefined` = 未注入宿主连线。 */
  onResumeMember?: (memberId: string) => void;
}

const MemberApprovalQueue: React.FC<MemberApprovalQueueProps> = React.memo(
  ({ tasks, member, onOpenTerminal, onResumeMember }) => {
    const action = openTerminalAction(member);
    // 句柄从**同一份**判据的输入里取：`session.terminalId` 只在 `live` 时非空，
    // 所以这里不存在「判据说能开、句柄却是空的」这种错位。
    const terminalId = member.session.terminalId;
    /**
     * 「去终端处理」能不能真去。
     *
     * `active`（可恢复）**能**：点下去先 `team_resume` 把对话接回来，用户才能在它自己的
     * 终端里批。`archive`（只看得到记录）**不能**：历史里没有审批框，把它当成可点就是一次
     * 静默的空点击 —— 所以这里单独置灰并给出可见理由（`action.reason` 对 archive 是 null，
     * 因为那个态本身不是错误）。
     */
    const canGoToTerminal = action.enabled && action.kind !== 'archive';
    const blockedReason = action.kind === 'archive' ? '进程已退出，只能在历史里看' : action.reason;

    const handleOpen = useCallback(() => {
      // 置灰是 UI，**零调用**是行为（与花名册行同一条判据）。
      if (!canGoToTerminal) return;
      // 成员进程已不在但可恢复：先起新进程，用户才能在它自己的终端里批。
      if (action.kind === 'resume') {
        onResumeMember?.(member.memberId);
        return;
      }
      // `terminalId === null` 时连回调都不碰。
      if (terminalId === null) return;
      onOpenTerminal(terminalId, member.name, member.agentId);
    }, [
      action.kind,
      canGoToTerminal,
      member.agentId,
      member.memberId,
      member.name,
      onOpenTerminal,
      onResumeMember,
      terminalId,
    ]);

    // 空队列 → 什么都不画（见文件头「空队列不渲染」）。
    if (tasks.length === 0) return null;

    return (
      <section
        aria-label="待批队列"
        className="flex flex-col gap-1 rounded-md border border-accent-yellow/60 bg-accent-yellow/10 px-2 py-1.5"
      >
        <header className="flex items-baseline gap-1.5">
          <h4 className="text-meta font-semibold text-accent-yellow">待批 {tasks.length} 条</h4>
          <span className="text-micro text-text-muted">审批在它自己的终端里</span>
        </header>
        {/* 这句话是本块的全部价值：不写它，用户会在面板上找一个不存在的「批准」按钮。 */}
        <p className="text-micro text-text-secondary">
          Neeko 不代批：请到成员自己的终端里确认。面板只负责把「谁卡在审批上」摆出来。
        </p>
        <ul className="flex flex-col gap-1">
          {tasks.map((task) => (
            <li key={task.id} className="rounded border border-border bg-bg-primary px-1.5 py-1">
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-meta text-text-primary">
                  {task.title}
                </span>
                <span className="shrink-0 font-mono text-micro text-text-muted">{task.id}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-micro text-text-muted">
                  {taskStateLabel(task.state)}
                  {blockedReason === null ? '' : ` · ${blockedReason}`}
                </span>
                <button
                  type="button"
                  onClick={handleOpen}
                  disabled={!canGoToTerminal}
                  aria-label={`去终端处理待批任务：${task.title}`}
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-micro font-semibold',
                    'text-accent-yellow hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-yellow focus-visible:outline-none',
                    'disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-transparent',
                  )}
                >
                  去终端处理
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  },
);
MemberApprovalQueue.displayName = 'MemberApprovalQueue';

export default MemberApprovalQueue;

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
 */
interface MemberApprovalQueueProps {
  /** AC5 队列（后端已经按 `state === awaiting_approval` 且 `owner === 该成员` 过滤）。 */
  tasks: readonly TaskCard[];
  /** 成员行 —— 「去终端处理」的可用性与理由都从它派生（`openTerminalAction`）。 */
  member: Pick<MemberStatusView, 'terminalId' | 'name'>;
  onOpenTerminal: (terminalId: string, title: string) => void;
}

const MemberApprovalQueue: React.FC<MemberApprovalQueueProps> = React.memo(
  ({ tasks, member, onOpenTerminal }) => {
    const action = openTerminalAction(member);
    const terminalId = member.terminalId;

    const handleOpen = useCallback(() => {
      // 置灰是 UI，**零调用**是行为：没有进程时连回调都不碰（与花名册行同一条判据）。
      if (terminalId === null) return;
      onOpenTerminal(terminalId, member.name);
    }, [member.name, onOpenTerminal, terminalId]);

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
                  {action.reason === null ? '' : ` · ${action.reason}`}
                </span>
                <button
                  type="button"
                  onClick={handleOpen}
                  disabled={!action.enabled}
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

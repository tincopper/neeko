import React, { useCallback, useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { MemberStatusView, TaskCard } from '@/shared/types/team';

import { taskLease } from '../utils/leaseText';
import { memberBadge } from '../utils/memberBadge';
import { taskStateLabel } from '../utils/taskBoard';
import { workspaceLabel } from '../utils/workspaceLabel';

import Chip from './Chip';

/**
 * 任务板上的一张卡片：标题 + owner chip + 租约 / 「成员已空闲但没人认可」提示。
 *
 * # 没有正文
 *
 * 列路径没有 `body`（红线 4，类型层面也没有这个字段）。正文只在**点开**之后从
 * `team_task_detail` 来。
 *
 * # 「成员已空闲，但没人认可完成」必须看得出来
 *
 * 这是 design §6 硬规则 1 的 UI 侧：`idle` 只说「它这一轮说完了」，**不等于**做完了。
 * 任务仍留在「进行中」列时，卡片上要能看到持有者当前的状态（`空闲 ⚠ 未声明`），
 * 否则用户会以为「它空闲了，这活应该完了吧」。持有者由 `owner`（member id）查到——
 * 查不到就不显示，不猜。
 */
interface TaskCardRowProps {
  task: TaskCard;
  /** 持有者对应的成员行（`null` = 板上没有这个 owner，不猜）。 */
  owner: MemberStatusView | null;
  /**
   * 被指派者的成员行（`null` = 未指派，或指派者不在花名册里）。
   *
   * 只在**未认领**时显示「已指派 · {name}」：已认领的卡片上持有者 chip 已经是「谁在做」，
   * 再挂一张指派标签会在 300px 的列里说两遍“谁负责”。
   */
  assignee: MemberStatusView | null;
  /** 时间基准（**注入**，纯函数才算得出来：「剩余」是派生值，不是状态）。 */
  now: number;
  /**
   * 打开详情：**两个参数一起给**（`teamId` 在前）。
   *
   * 任务 id 只在队内唯一，所以「打开 t1」不是一个完整的动作 —— 卡片自己带着 `task.teamId`，
   * 调用点不必知道当前在哪个队。
   */
  onOpen: (teamId: string, taskId: string, title: string) => void;
}

const TaskCardRow: React.FC<TaskCardRowProps> = React.memo(
  ({ task, owner, assignee, now, onOpen }) => {
    const handleClick = useCallback(
      () => onOpen(task.teamId, task.id, task.title),
      [onOpen, task.teamId, task.id, task.title],
    );
    const lease = useMemo(() => taskLease(task, now), [task, now]);
    const ownerBadge = owner ? memberBadge(owner) : null;

    return (
      <li>
        <button
          type="button"
          onClick={handleClick}
          data-task-id={task.id}
          aria-label={`打开任务 ${task.id} 的详情：${task.title}`}
          className={cn(
            'w-full rounded-md border border-border bg-bg-primary px-2 py-1.5 text-left',
            'hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
          )}
        >
          <div className="flex items-start gap-1.5">
            <span className="min-w-0 flex-1 text-meta font-medium text-text-primary">
              {task.title}
            </span>
            <span className="shrink-0 font-mono text-micro text-text-muted">{task.id}</span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-1">
            {/* 列已经表达了状态，但同一列里 `claimed` 与 `in_progress` 是两个阶段 */}
            <Chip tone="outline">{taskStateLabel(task.state)}</Chip>
            <Chip tone="outline">{workspaceLabel(task.workspace)}</Chip>
            {owner ? (
              <Chip tone="accent" title={`持有者 ${owner.memberId}`}>
                {owner.name}
              </Chip>
            ) : null}
            {owner === null && assignee ? (
              // 指派是**计划事实**（谁该做）：尚未认领时才值得占位 —— 它告诉用户
              // 「这张卡在等谁」，而 `title` 带完整成员 id（名字可能重）。
              <Chip tone="outline" title={`被指派者 ${assignee.memberId}`}>
                {`已指派 · ${assignee.name}`}
              </Chip>
            ) : null}
            {task.dependsOn.length > 0 ? (
              <Chip tone="default">{`依赖 ${task.dependsOn.length}`}</Chip>
            ) : null}
            {task.reclaimCount > 0 ? (
              <Chip tone="warn">{`被回收 ${task.reclaimCount} 次`}</Chip>
            ) : null}
            {task.summaryTruncated ? <Chip tone="warn">摘要已截断</Chip> : null}
          </div>

          {lease === null && ownerBadge === null ? null : (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro">
              {lease === null ? null : (
                <span
                  className={cn(
                    'whitespace-nowrap',
                    lease.urgent ? 'font-semibold text-accent-yellow' : 'text-text-muted',
                  )}
                >
                  {lease.text}
                </span>
              )}
              {ownerBadge === null ? null : (
                // 持有者的真实状态：`空闲 ⚠ 未声明` 与「已完成」在这里长得完全不同（AC2）
                <span
                  data-tone={ownerBadge.tone}
                  title={ownerBadge.ariaLabel}
                  className={cn(
                    ownerBadge.tone === 'unverified'
                      ? 'border border-dashed border-accent-yellow text-accent-yellow'
                      : 'text-text-muted',
                    'whitespace-nowrap',
                  )}
                >
                  {ownerBadge.text}
                </span>
              )}
            </div>
          )}
        </button>
      </li>
    );
  },
);
TaskCardRow.displayName = 'TaskCardRow';

export default TaskCardRow;

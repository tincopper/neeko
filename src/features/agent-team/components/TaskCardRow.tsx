import { RotateCcw } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { MemberState, MemberStatusView, TaskCard, TeamTaskState } from '@/shared/types/team';

import { taskLease } from '../utils/leaseText';
import { memberBadge, type MemberBadge } from '../utils/memberBadge';
import { canRetry, taskStateLabel } from '../utils/taskBoard';
import { nonDefaultWorkspaceLabel } from '../utils/workspaceLabel';

import Chip from './Chip';

/**
 * 任务板上的一张卡片：标题 + 「归谁 / 在哪 / 要不要紧」。
 *
 * # 没有正文
 *
 * 列路径没有 `body`（红线 4，类型层面也没有这个字段）。正文只在**点开**之后从
 * `team_task_detail` 来。
 *
 * # 卡片上不重复列与花名册已经说过的话（R6 / R7）
 *
 * | 不再渲染 | 为什么 |
 * | --- | --- |
 * | 状态 chip（列唯一确定状态时）| 卡片在「进行中」列里再写一次「进行中」是零信息 |
 * | 缺省工作区（`shared`）| 建队缺省值，几乎每张卡都有 —— 等于没有信息 |
 * | 可见的 `task.id` | 只在队内唯一的内部标识，属于详情（仍在 `aria-label` / `data-task-id`）|
 * | `依赖 N` | 依赖关系是详情里的事；窄列里它抢的是标题的位置 |
 *
 * 保留：持有者 / 指派（谁在做、在等谁）· 被回收次数 · 摘要截断 · 重试。
 *
 * # 「成员已空闲，但没人认可完成」必须看得出来
 *
 * 这是 design §6 硬规则 1 的 UI 侧：`idle` 只说「它这一轮说完了」，**不等于**做完了。
 * 任务仍留在列里（未终结）时，卡片上要能看到持有者当前的状态（`空闲 ⚠ 未声明`），
 * 否则用户会以为「它空闲了，这活应该完了吧」。
 *
 * 反过来，`运行中` / `待批准` 不在这里重复：花名册行上已经有同一枚徽标，而 `done` /
 * `failed` / `blocked` 的任务已经终结 —— 持有者现在是什么状态不再影响这张卡该不该被处理。
 * 持有者由 `owner`（member id）查到；查不到就不显示，不猜。
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
   * 这一列是否**无法唯一确定**卡片状态（`TeamTaskBoard` 按 `column.states.length > 1` 算）。
   *
   * 为 `false` 时卡片不渲染状态 chip：列标签已经说完了。为 `true` 时（`claimed` /
   * `in_progress` 同列、`failed` / `blocked` 同列）必须渲染，否则同一列里的两个阶段不可区分。
   */
  showState: boolean;
  /**
   * 打开详情：**两个参数一起给**（`teamId` 在前）。
   *
   * 任务 id 只在队内唯一，所以「打开 t1」不是一个完整的动作 —— 卡片自己带着 `task.teamId`，
   * 调用点不必知道当前在哪个队。
   */
  onOpen: (teamId: string, taskId: string, title: string) => void;
  /**
   * 重试任务（`team_task_retry`；`undefined` = 宿主没接重试动作）。
   *
   * 只在 [`canRetry`]（`failed` / `blocked`）为真时渲染 —— **不做灰按钮**：
   * 一个灰掉的「重试」会让用户去找一个不存在的动作，而不渲染只说「这个状态下没有
   * 这个动作」。判据是纯函数，卡片与任务详情共用同一份。
   */
  onRetry?: (task: TaskCard) => void;
}

/** 已终结的任务：它还在列里，但「持有者现在什么状态」不再改变用户该做的事。 */
const TERMINAL_STATES: ReadonlySet<TeamTaskState> = new Set(['done', 'failed', 'blocked']);

/**
 * 持有者里**需要人看一眼**的那几种（`运行中` / `待批准` / `完成` 不在其中）。
 *
 * `idle + unverified` 要单算：`idle` 本身正常，只有「没人认可这次完成」时才值得说。
 */
const ATTENTION_STATES: ReadonlySet<MemberState> = new Set(['stalled', 'offline', 'failed']);

function ownerAttention(owner: MemberStatusView | null, task: TaskCard): MemberBadge | null {
  if (owner === null) return null;
  if (TERMINAL_STATES.has(task.state)) return null;
  const attention =
    (owner.state === 'idle' && owner.verification === 'unverified') ||
    ATTENTION_STATES.has(owner.state);
  return attention ? memberBadge(owner) : null;
}

const TaskCardRow: React.FC<TaskCardRowProps> = React.memo(
  ({ task, owner, assignee, now, showState, onOpen, onRetry }) => {
    const handleClick = useCallback(
      () => onOpen(task.teamId, task.id, task.title),
      [onOpen, task.teamId, task.id, task.title],
    );
    const lease = useMemo(() => taskLease(task, now), [task, now]);
    const workspace = nonDefaultWorkspaceLabel(task.workspace);
    const attention = ownerAttention(owner, task);
    const retryable = onRetry !== undefined && canRetry(task.state);
    const handleRetry = useCallback(() => onRetry?.(task), [onRetry, task]);

    return (
      // 重试是卡片的**兄弟**元素而不是子元素：卡片整体是一个 button，嵌套 button
      // 是无效 HTML（浏览器会把内层剥出来，行为变得不可预测）。
      <li className="flex items-stretch gap-1">
        <button
          type="button"
          onClick={handleClick}
          data-task-id={task.id}
          aria-label={`打开任务 ${task.id} 的详情：${task.title}`}
          className={cn(
            'w-full min-w-0 rounded-md border border-border bg-bg-primary px-2 py-1 text-left',
            'hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
          )}
        >
          <span className="block min-w-0 truncate text-meta font-medium text-text-primary">
            {task.title}
          </span>

          <span className="mt-0.5 flex flex-wrap items-center gap-1">
            {/* 列已经表达了状态；只有同列多态（claimed / in_progress、failed / blocked）才需要 */}
            {showState ? <Chip tone="outline">{taskStateLabel(task.state)}</Chip> : null}
            {workspace === null ? null : <Chip tone="outline">{workspace}</Chip>}
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
            {task.reclaimCount > 0 ? (
              <Chip tone="warn">{`被回收 ${task.reclaimCount} 次`}</Chip>
            ) : null}
            {task.summaryTruncated ? <Chip tone="warn">摘要已截断</Chip> : null}
            {/* 租约并入这一行：它和时间一样是「还要多久」的派生值，不值得单起一行 */}
            {lease === null ? null : (
              <span
                className={cn(
                  'text-micro whitespace-nowrap',
                  lease.urgent ? 'font-semibold text-accent-yellow' : 'text-text-muted',
                )}
              >
                {lease.text}
              </span>
            )}
          </span>

          {attention === null ? null : (
            // 持有者的真实状态：`空闲 ⚠ 未声明` 与「已完成」在这里长得完全不同（AC2）
            <span
              data-tone={attention.tone}
              title={attention.ariaLabel}
              className={cn(
                'mt-0.5 block text-micro whitespace-nowrap',
                attention.tone === 'unverified'
                  ? 'border border-dashed border-accent-yellow text-accent-yellow'
                  : 'text-text-muted',
              )}
            >
              {attention.text}
            </span>
          )}
        </button>
        {retryable ? (
          <button
            type="button"
            onClick={handleRetry}
            data-retry-task-id={task.id}
            aria-label={`重试任务 ${task.id}`}
            className={cn(
              'shrink-0 self-center rounded-md border border-border p-1.5 text-text-secondary',
              'hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
            )}
          >
            <RotateCcw size={13} aria-hidden="true" />
          </button>
        ) : null}
      </li>
    );
  },
);
TaskCardRow.displayName = 'TaskCardRow';

export default TaskCardRow;

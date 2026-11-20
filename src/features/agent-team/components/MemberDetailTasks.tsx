import React from 'react';

import { cn } from '@/lib/utils';
import type { TaskCard } from '@/shared/types/team';

import { taskLease } from '../utils/leaseText';
import { MAX_BOARD_TASKS, taskStateLabel } from '../utils/taskBoard';

/**
 * 抽屉里的「当前任务」：该成员在飞的任务 + 它最近完成的（后端已排序：在飞在前）。
 *
 * # 每行四样，一个都不省
 *
 * | 行内信息 | 回答什么 |
 * | --- | --- |
 * | 标题 | 它在干什么 |
 * | 状态 | 干到哪一步了（`claimed` 与 `in_progress` 是两个阶段，不能只画一个）|
 * | 租约 | 还有多久被回收 |
 * | 回收次数 | 「反复失败」—— 同一件活被抢走四轮会进 `blocked`，那时再查就晚了 |
 *
 * # 租约由调用方注入 `now`
 *
 * 「剩余多久」是派生值，不是状态：组件每帧重算，`now` 由抽屉的 1s 定时器推进
 * （见 `MemberDetailDrawer`）。组件自己持一个时钟会让「打开抽屉就多一个全局定时器」。
 */
interface MemberDetailTasksProps {
  tasks: readonly TaskCard[];
  /** 是否被后端上界截断（`view::MAX_BOARD_TASKS`）。 */
  truncated: boolean;
  /** 时间基准（抽屉的定时器推进它，租约因此会走动）。 */
  now: number;
}

const MemberDetailTasks: React.FC<MemberDetailTasksProps> = React.memo(
  ({ tasks, truncated, now }) => (
    <section aria-label="Member current tasks" className="flex flex-col gap-1">
      <header className="flex items-baseline justify-between">
        <h4 className="text-meta font-semibold text-text-secondary">Current tasks</h4>
        <span className="text-micro text-text-muted">{tasks.length} entries</span>
      </header>
      {tasks.length === 0 ? (
        <p className="text-micro text-text-muted">No tasks in hand (none finished either)</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {tasks.map((task) => {
            const lease = taskLease(task, now);
            return (
              <li
                key={task.id}
                data-task-id={task.id}
                className="rounded border border-border bg-bg-primary px-1.5 py-1"
              >
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-meta text-text-primary">
                    {task.title}
                  </span>
                  <span className="shrink-0 font-mono text-micro text-text-muted">{task.id}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro">
                  <span className="whitespace-nowrap text-text-secondary">
                    {taskStateLabel(task.state)}
                  </span>
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
                  {task.reclaimCount > 0 ? (
                    <span className="whitespace-nowrap text-accent-yellow">
                      Reclaimed {task.reclaimCount} times
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {truncated ? (
        // 有界 + 说出来：不说就是「静默丢」（红线 4 的口径）。
        <p className="text-micro text-accent-yellow">Showing first {MAX_BOARD_TASKS} tasks</p>
      ) : null}
    </section>
  ),
);
MemberDetailTasks.displayName = 'MemberDetailTasks';

export default MemberDetailTasks;

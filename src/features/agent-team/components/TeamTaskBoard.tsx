import React, { useCallback, useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { TaskCard } from '@/shared/types/team';

import {
  MAX_BOARD_TASKS,
  buildTaskBoard,
  taskStateLabel,
  workspaceLabel,
} from '../utils/taskBoard';

/**
 * 共享任务板（原型视图 ① 中栏）。
 *
 * # 布局为什么是纵向堆叠而不是五栏横排
 *
 * 原型是整窗宽度的三栏，这里是 dock 右栏（最小 ~280px）。五个横排小列在这个宽度下每列
 * 只剩 50px，标题会折成三行。所以**列语义保留**（`TASK_COLUMNS` 不变、每个状态都归列），
 * 只把「列」从并排改成上下分段 —— 换的是排版，不是分类。
 *
 * # 卡片上没有正文
 *
 * 列路径没有 `body`（红线 4，类型层面也没有这个字段）。卡片显示的是 title / owner /
 * 依赖数 / 回收次数 / 摘要截断标记；正文只在**点开**之后从 `team_task_detail` 来。
 */

interface TaskCardRowProps {
  task: TaskCard;
  onOpen: (taskId: string) => void;
}

const TaskCardRow: React.FC<TaskCardRowProps> = React.memo(({ task, onOpen }) => {
  const handleClick = useCallback(() => onOpen(task.id), [onOpen, task.id]);

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        data-task-id={task.id}
        aria-label={`打开任务 ${task.id} 的详情：${task.title}`}
        className={cn(
          'w-full rounded-md border border-border bg-bg-secondary px-2 py-1.5 text-left',
          'hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
        )}
      >
        <div className="flex items-start gap-1.5">
          <span className="min-w-0 flex-1 text-meta text-text-primary">{task.title}</span>
          <span className="shrink-0 font-mono text-micro text-text-muted">{task.id}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-text-muted">
          <span>{taskStateLabel(task.state)}</span>
          <span>{workspaceLabel(task.workspace)}</span>
          {task.owner ? <span className="truncate">{task.owner}</span> : null}
          {task.dependsOn.length > 0 ? <span>依赖 {task.dependsOn.length}</span> : null}
          {task.reclaimCount > 0 ? (
            <span className="text-accent-yellow">被回收 {task.reclaimCount} 次</span>
          ) : null}
          {task.summaryTruncated ? <span className="text-accent-yellow">摘要已截断</span> : null}
        </div>
      </button>
    </li>
  );
});
TaskCardRow.displayName = 'TaskCardRow';

interface TeamTaskBoardProps {
  tasks: readonly TaskCard[];
  /** 后端置位：任务行超过列载荷上界被截断。 */
  tasksTruncated: boolean;
  onOpenTask: (taskId: string) => void;
}

const TeamTaskBoard: React.FC<TeamTaskBoardProps> = React.memo(
  ({ tasks, tasksTruncated, onOpenTask }) => {
    const board = useMemo(() => buildTaskBoard(tasks), [tasks]);

    return (
      <section aria-label="共享任务板" className="flex flex-col gap-2 p-2">
        <header className="flex flex-wrap items-center justify-between gap-1 px-1">
          <h3 className="text-meta font-semibold text-text-secondary">共享任务板</h3>
          <span className="text-micro text-text-muted">{tasks.length} 个任务</span>
        </header>
        {tasksTruncated ? (
          // 截断必须**说出来**：不说的话面板看起来像「团队真的只有 200 个任务」。
          <p role="status" className="px-1 text-micro text-accent-yellow">
            只显示前 {MAX_BOARD_TASKS} 条
          </p>
        ) : null}
        <div className="flex flex-col gap-3">
          {board.columns.map(({ column, tasks: columnTasks }) => (
            <div
              key={column.id}
              data-column={column.id}
              // 列是「分组」而不是纯样式容器：测试与读屏靠 label 定位它
              // （文案会随语言改，`data-column` 是稳定的机器标识）。
              role="group"
              aria-label={column.label}
              className="flex flex-col gap-1"
            >
              <div className="flex items-center gap-1.5 px-1">
                <span className="text-micro font-semibold text-text-secondary">{column.label}</span>
                <span className="text-micro text-text-muted">{columnTasks.length}</span>
              </div>
              {columnTasks.length === 0 ? (
                <p className="px-1 text-micro text-text-muted">—</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {columnTasks.map((task) => (
                    <TaskCardRow key={task.id} task={task} onOpen={onOpenTask} />
                  ))}
                </ul>
              )}
            </div>
          ))}
          {board.unplaced.length > 0 ? (
            // 列契约漏了一个状态时**不许静默丢任务**：宁可显示一句丑话。
            <p role="alert" className="px-1 text-micro text-accent-red">
              {board.unplaced.length} 个任务的状态没有对应的列
            </p>
          ) : null}
        </div>
      </section>
    );
  },
);
TeamTaskBoard.displayName = 'TeamTaskBoard';

export default TeamTaskBoard;

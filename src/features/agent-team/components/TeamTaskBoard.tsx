import React, { useMemo } from 'react';

import type { MemberStatusView, TaskCard } from '@/shared/types/team';

import { MAX_BOARD_TASKS, buildTaskBoard } from '../utils/taskBoard';

import TaskCardRow from './TaskCardRow';

/**
 * 共享任务板（原型视图 ① 中栏）。
 *
 * # 布局为什么是纵向堆叠而不是五栏横排
 *
 * 原型是整窗宽度的五栏，这里是 dock 右栏（最小 ~280px）。五个横排小列在这个宽度下每列
 * 只剩 50px，标题会折成三行。所以**列语义保留**（`TASK_COLUMNS` 不变、每个状态都归列），
 * 只把「列」从并排改成上下分段 —— 换的是排版，不是分类。少一列就是丢任务：`claimed` 若被
 * 漏掉，刚认领的活会从板上消失（用户看到「队长派了活但板是空的」）。
 *
 * # 计数来自这一列的**行**，不是一个并列的计数器
 *
 * `columnTasks.length` 是唯一来源。另存一份计数会在每次刷新时漂移，而漂移只在「刚有人认领」
 * 这种瞬间显形 —— 那时的用户正需要它准确。
 *
 * # 卡片上没有正文
 *
 * 列路径没有 `body`（红线 4，类型层面也没有这个字段），正文只在**点开**之后拉。
 */
interface TeamTaskBoardProps {
  tasks: readonly TaskCard[];
  /** 花名册，用于把卡片上的 `owner` 解析成「持有者现在什么状态」。 */
  members: readonly MemberStatusView[];
  /** 后端置位：任务行超过列载荷上界被截断。 */
  tasksTruncated: boolean;
  /** 打开任务详情（`teamId` 在前：任务 id 只在队内唯一）。 */
  onOpenTask: (teamId: string, taskId: string) => void;
}

const TeamTaskBoard: React.FC<TeamTaskBoardProps> = React.memo(
  ({ tasks, members, tasksTruncated, onOpenTask }) => {
    const board = useMemo(() => buildTaskBoard(tasks), [tasks]);
    const memberById = useMemo(
      () => new Map(members.map((member) => [member.memberId, member])),
      [members],
    );
    // 「租约还剩多久」是派生值：每次渲染取一次当前时间即可，不进 state（否则要起定时器，
    // 而定时器会在面板不可见时继续跑）。
    const now = Date.now();

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
        <div className="flex flex-col gap-1.5">
          {board.columns.map(({ column, tasks: columnTasks }) => (
            <div
              key={column.id}
              data-column={column.id}
              // 列是「分组」而不是纯样式容器：测试与读屏靠 label 定位它
              // （文案会随语言改，`data-column` 是稳定的机器标识）。
              role="group"
              aria-label={column.label}
              className="flex flex-col gap-1 rounded-md border border-border bg-bg-secondary p-1"
            >
              <div className="flex items-center gap-1.5 px-1">
                <span className="text-micro font-semibold text-text-secondary">{column.label}</span>
                <span
                  data-count={columnTasks.length}
                  className="rounded-full bg-bg-tertiary px-1 text-micro text-text-muted"
                >
                  {columnTasks.length}
                </span>
              </div>
              {columnTasks.length === 0 ? (
                <p className="px-1 text-micro text-text-muted">—</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {columnTasks.map((task) => (
                    <TaskCardRow
                      key={task.id}
                      task={task}
                      owner={task.owner === null ? null : (memberById.get(task.owner) ?? null)}
                      now={now}
                      onOpen={onOpenTask}
                    />
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

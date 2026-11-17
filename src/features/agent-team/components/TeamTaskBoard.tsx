import React, { useMemo } from 'react';

import type { MemberStatusView, TaskCard } from '@/shared/types/team';

import { MAX_BOARD_TASKS, buildTaskBoard, taskStateLabel } from '../utils/taskBoard';

import TaskCardRow from './TaskCardRow';

/**
 * 共享任务板（原型视图 ① 中栏）。
 *
 * # 布局为什么是纵向堆叠而不是五栏横排
 *
 * 原型是整窗宽度的五栏，这里是 dock 右栏（最小 ~260px）。五个横排小列在这个宽度下每列
 * 只剩 50px，标题会折成三行。所以**列语义保留**（`TASK_COLUMNS` 不变、每个状态都归列），
 * 只把「列」从并排改成上下分段 —— 换的是排版，不是分类。少一列就是丢任务：`claimed` 若被
 * 漏掉，刚认领的活会从板上消失（用户看到「队长派了活但板是空的」）。
 *
 * # 分组是**紧凑分组**，不是盒子（R12）
 *
 * 每一列不再有外框 / 底色 / 内边距，只留「标题行 + 卡片列表」。280px 下每列省约 12px，
 * 而列语义一点没少：`data-column` / `role="group"` / `aria-label` / 计数都在 ——
 * **机器标识不随样式变**（测试与读屏继续按它们定位）。
 *
 * 视觉分层仍成立：卡片自己是 `bg-bg-primary` + 边框，落在面板的岛内底色上，不靠外层盒子。
 *
 * # 空列收成一行汇总（R5）
 *
 * 五个列里常有两三个是空的，而空列此前也占「label + count + —」约 40px。空列现在收进
 * 末尾一行：`待认领 0 · 阻塞 0`。汇总项仍带 `data-column` + `data-count="0"`：
 * 「这一列有几行」这个不变量必须还能被机器读到（列映射是封闭枚举，空列 ≠ 列不存在）。
 *
 * # 计数来自这一列的**行**，不是一个并列的计数器
 *
 * `columnTasks.length` 是唯一来源。另存一份计数会在每次刷新时漂移，而漂移只在「刚有人认领」
 * 这种瞬间显形 —— 那时的用户正需要它准确。
 *
 * # 标题与总计数不在这里
 *
 * `TeamView` 的任务区头（`任务 N` + 视图切换 + 折叠）与 `TeamBoardCenterView` 的头部各自
 * 显示计数 —— 本组件只负责板本身（`aria-label="共享任务板"` 是它的稳定锚点）。
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
  onOpenTask: (teamId: string, taskId: string, title: string) => void;
  /**
   * 重试任务（`undefined` = 宿主没接，卡片不渲染重试按钮）。
   *
   * 可重试判据在 `taskBoard.ts::canRetry`（卡片内部判，与任务详情共用同一份），
   * 这里只把动作接进来 —— 宿主注入 handler，卡片不知道「重试之后会发生什么」。
   */
  onRetryTask?: (task: TaskCard) => void;
}

const TeamTaskBoard: React.FC<TeamTaskBoardProps> = React.memo(
  ({ tasks, members, tasksTruncated, onOpenTask, onRetryTask }) => {
    const board = useMemo(() => buildTaskBoard(tasks), [tasks]);
    const memberById = useMemo(
      () => new Map(members.map((member) => [member.memberId, member])),
      [members],
    );
    // 空列只在**渲染层**折叠：一条也不从 `board.columns` 里删（列契约是封闭枚举）
    const { nonEmpty, empty } = useMemo(
      () => ({
        nonEmpty: board.columns.filter((column) => column.tasks.length > 0),
        empty: board.columns.filter((column) => column.tasks.length === 0),
      }),
      [board],
    );
    // 「租约还剩多久」是派生值：每次渲染取一次当前时间即可，不进 state（否则要起定时器，
    // 而定时器会在面板不可见时继续跑）。
    const now = Date.now();

    return (
      <section aria-label="共享任务板" className="flex flex-col gap-1.5 px-2 pb-2">
        {tasksTruncated ? (
          // 截断必须**说出来**：不说的话面板看起来像「团队真的只有 200 个任务」。
          <p role="status" className="px-1 text-micro text-accent-yellow">
            只显示前 {MAX_BOARD_TASKS} 条
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          {nonEmpty.map(({ column, tasks: columnTasks }) => (
            <div
              key={column.id}
              data-column={column.id}
              // 列是「分组」而不是纯样式容器：测试与读屏靠 label 定位它
              // （文案会随语言改，`data-column` 是稳定的机器标识）。
              role="group"
              aria-label={column.label}
              // 紧凑分组：没有边框 / 底色 / 内边距（R12）。分层由卡片自己的表面承担。
              className="flex flex-col gap-1"
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
              <ul className="flex flex-col gap-1">
                {columnTasks.map((task) => (
                  <TaskCardRow
                    key={task.id}
                    task={task}
                    owner={task.owner === null ? null : (memberById.get(task.owner) ?? null)}
                    // 指派者同样从花名册解析：查不到（已退出 / 不在本次载荷里）就不猜名字。
                    assignee={task.assignee ? (memberById.get(task.assignee) ?? null) : null}
                    now={now}
                    // 列**无法唯一确定**状态、且卡片状态与列名不同时才标（同列多态）。
                    // 两层条件缺一不可：`进行中` 列里的 `in_progress` 卡片仍然是零信息。
                    showState={
                      column.states.length > 1 && taskStateLabel(task.state) !== column.label
                    }
                    onOpen={onOpenTask}
                    onRetry={onRetryTask}
                  />
                ))}
              </ul>
            </div>
          ))}
          {board.unplaced.length > 0 ? (
            // 列契约漏了一个状态时**不许静默丢任务**：宁可显示一句丑话。
            <p role="alert" className="px-1 text-micro text-accent-red">
              {board.unplaced.length} 个任务的状态没有对应的列
            </p>
          ) : null}
          {empty.length === 0 ? null : (
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-micro text-text-muted">
              {empty.map(({ column }, index) => (
                <React.Fragment key={column.id}>
                  {index === 0 ? null : <span aria-hidden="true">·</span>}
                  <span data-column={column.id} data-count={0}>
                    {`${column.label} 0`}
                  </span>
                </React.Fragment>
              ))}
            </p>
          )}
        </div>
      </section>
    );
  },
);
TeamTaskBoard.displayName = 'TeamTaskBoard';

export default TeamTaskBoard;

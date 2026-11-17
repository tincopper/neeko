import { ChevronDown, ChevronRight, Columns3, GitBranch, Maximize2 } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import type { MemberStatusView, TaskCard } from '@/shared/types/team';

import { MAX_BOARD_TASKS, buildTaskBoard } from '../utils/taskBoard';

import TeamFlowGraph from './TeamFlowGraph';
import TeamTaskBoard from './TeamTaskBoard';

/**
 * 面板里的**任务区**：一条头 + 看板 / 分配图 + 折叠（R10）。
 *
 * ```
 * 任务 4                        [▦|⑂] [↗] [▾]
 * ```
 *
 * 视图切换是**图标按钮**（R15）：`Columns3` / `GitBranch`，与中央 tab 的
 * `TeamBoardCenterView` 同一对图标。窄列里省掉两个词，可访问名仍是「看板 / 分配图」
 * （`aria-label` + `title`）—— 图标化不降级可访问名。
 *
 * # 为什么标题与计数在这条头上
 *
 * 任务板不再渲染自己的标题行（否则同一屏两个「共享任务板」）。总计数、视图切换、
 * 「在中间打开」、折叠 都收在这一条里 —— 中央 tab（`TeamBoardCenterView`）用自己的头部
 * 显示同一份计数（`snapshot.tasks.length`），两处都从快照派生，不另存计数器。
 *
 * # 两个导航态都就近放这里
 *
 * `taskView`（看板 / 分配图）与 `boardCollapsed`（展开 / 折叠）都是**导航**：它们不改变
 * 快照，只改变同一份快照怎么画。所以是局部 `useState`，不进 store（store 存的是数据面）。
 * 折叠**默认展开**（D3）：折叠是用户的主动动作，不是我们对默认值的判断。
 *
 * # 折叠只对看板成立
 *
 * 分配图是一张拓扑图，「收起一半」没有含义 —— 切到分配图时折叠按钮不渲染，图照常展示。
 */
interface TeamTaskSectionProps {
  tasks: readonly TaskCard[];
  members: readonly MemberStatusView[];
  /** 后端置位：任务行超过列载荷上界被截断。 */
  tasksTruncated: boolean;
  onOpenTask: (teamId: string, taskId: string, title: string) => void;
  /**
   * 把当前任务视图（看板 / 分配图）作为**中央 tab**打开（260px 列装不下整张板）。
   * `undefined` = 宿主未注入跨域连线（按钮不渲染）。
   */
  onOpenBoard?: (view: 'board' | 'flow') => void;
}

const TeamTaskSection: React.FC<TeamTaskSectionProps> = React.memo(
  ({ tasks, members, tasksTruncated, onOpenTask, onOpenBoard }) => {
    const [taskView, setTaskView] = useState<'board' | 'flow'>('board');
    const [boardCollapsed, setBoardCollapsed] = useState(false);

    /**
     * 折叠后的一行摘要：总计数 + 非空列（空列在板里已有汇总，收起时不必再报）。
     *
     * 截断必须**跟着收起来**：板上那条 `role="status"` 随板一起卸载，只剩一句
     * 「200 个任务」看起来就像团队真的只有 200 个。
     */
    const boardSummary = useMemo(() => {
      const nonEmpty = buildTaskBoard(tasks).columns.filter((column) => column.tasks.length > 0);
      return [
        `${tasks.length} 个任务`,
        ...nonEmpty.map((column) => `${column.column.label} ${column.tasks.length}`),
        ...(tasksTruncated ? [`只显示前 ${MAX_BOARD_TASKS} 条`] : []),
      ].join(' · ');
    }, [tasks, tasksTruncated]);

    const handleToggleBoard = useCallback(() => setBoardCollapsed((collapsed) => !collapsed), []);

    return (
      <>
        <div className="flex items-center gap-1 px-2 pt-1.5 pb-1">
          <span className="text-meta font-semibold text-text-secondary">任务</span>
          <span
            data-task-count={tasks.length}
            className="rounded-full bg-bg-tertiary px-1 text-micro text-text-muted"
          >
            {tasks.length}
          </span>
          <span className="sr-only">任务区视图</span>
          <div className="ml-auto flex items-center gap-0.5">
            {/*
              两个读法是**同一份快照的两个画法**（不是两个视图），所以它们做成一对
              `aria-pressed` 按钮，而不是一条 tab 条（tab 会宣告「切换了页面」）。
            */}
            {(
              [
                ['board', '看板', Columns3],
                ['flow', '分配图', GitBranch],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={taskView === value}
                aria-label={label}
                title={label}
                onClick={() => setTaskView(value)}
                className={cn(
                  'grid size-5 place-items-center rounded',
                  taskView === value
                    ? 'bg-bg-selected text-accent-blue'
                    : 'text-text-muted hover:bg-bg-hover',
                  'focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
                )}
              >
                <Icon size={12} aria-hidden="true" />
              </button>
            ))}
            {onOpenBoard ? (
              <button
                type="button"
                onClick={() => onOpenBoard(taskView)}
                aria-label="在中间区域打开任务视图"
                title="在中间区域打开（完整宽度）"
                className={cn(
                  'grid size-5 place-items-center rounded text-text-muted',
                  'hover:bg-bg-hover hover:text-text-primary',
                  'focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
                )}
              >
                <Maximize2 size={12} aria-hidden="true" />
              </button>
            ) : null}
            {taskView === 'board' ? (
              <button
                type="button"
                onClick={handleToggleBoard}
                aria-expanded={!boardCollapsed}
                aria-label={boardCollapsed ? '展开任务板' : '收起任务板'}
                title={boardCollapsed ? '展开任务板' : '收起任务板'}
                className={cn(
                  'grid size-5 place-items-center rounded text-text-muted',
                  'hover:bg-bg-hover hover:text-text-primary',
                  'focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
                )}
              >
                {boardCollapsed ? (
                  <ChevronRight size={12} aria-hidden="true" />
                ) : (
                  <ChevronDown size={12} aria-hidden="true" />
                )}
              </button>
            ) : null}
          </div>
        </div>
        {taskView === 'board' ? (
          boardCollapsed ? (
            // 折叠后只剩一行摘要：还有多少活、各在哪一列（点 ▸ 展开）
            <p className="px-2 pb-2 text-micro text-text-muted">{boardSummary}</p>
          ) : (
            <TeamTaskBoard
              tasks={tasks}
              members={members}
              tasksTruncated={tasksTruncated}
              onOpenTask={onOpenTask}
            />
          )
        ) : (
          <TeamFlowGraph tasks={tasks} members={members} onOpenTask={onOpenTask} />
        )}
      </>
    );
  },
);
TeamTaskSection.displayName = 'TeamTaskSection';

export default TeamTaskSection;

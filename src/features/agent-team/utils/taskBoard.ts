import type { TaskCard, TeamTaskState, Workspace } from '@/shared/types/team';

/**
 * 任务板的列契约（`prototype-agent-team.html` 视图 ① 的五列）。
 *
 * # 为什么列是「状态集」而不是「一个状态」
 *
 * 后端把生命周期拆得很细（`claimed` 与 `in_progress` 是同一件事的两个阶段：起了租约 /
 * 收到首轮 TurnStart），再按状态一比一开列会得到 8 列、其中三列常年只有一行。而
 * **合并的边界必须写在数据里**：`claimed` 若被漏掉，刚认领的任务会从板上消失（用户看到
 * 的是「队长派了活但板是空的」）。
 *
 * `blocked` 与 `failed` 同列（都是「冻结态」）：两者对队长的动作相同（人工介入），
 * 但卡片上仍分别标注（`failed` / `blocked` 文案不同）。
 */
export type TaskColumnId = 'pending' | 'in_progress' | 'awaiting_approval' | 'done' | 'frozen';
export interface TaskColumn {
  id: TaskColumnId;
  label: string;
  /** 归入本列的任务状态（**封闭枚举，缺一个就是丢任务**）。 */
  states: readonly TeamTaskState[];
}

export const TASK_COLUMNS: readonly TaskColumn[] = [
  // `proposed` 与 `pending` 同列：都是「还没人干活」，只是 proposed 还多了「等队长 accept」。
  { id: 'pending', label: '待认领', states: ['pending', 'proposed'] },
  { id: 'in_progress', label: '进行中', states: ['claimed', 'in_progress'] },
  { id: 'awaiting_approval', label: '待批准', states: ['awaiting_approval'] },
  { id: 'done', label: '已完成', states: ['done'] },
  { id: 'frozen', label: '阻塞', states: ['failed', 'blocked'] },
];

/** 状态 → 列。未登记的状态会落 `null`（测试断言它不存在，而不是静默丢弃）。 */
export function columnOf(state: TeamTaskState): TaskColumnId | null {
  return TASK_COLUMNS.find((column) => column.states.includes(state))?.id ?? null;
}

/**
 * 列载荷上界（**镜像** `src-tauri/src/agent/team/view.rs::MAX_BOARD_TASKS`）。
 *
 * 它只用于文案（「只显示前 N 条」）—— 真正的截断在后端做。改后端常量必须同步这里，
 * 否则提示会说出一个后端并没用过的数字。
 */
export const MAX_BOARD_TASKS = 200;

/** 一块板：每列的行（保持后端给的顺序，不在这里重排）。 */
export interface TaskBoard {
  columns: { column: TaskColumn; tasks: TaskCard[] }[];
  /** 落在所有列之外的任务（应为空；出现即「列契约漏了一个状态」）。 */
  unplaced: TaskCard[];
}

export function buildTaskBoard(tasks: readonly TaskCard[]): TaskBoard {
  const buckets = new Map<TaskColumnId, TaskCard[]>(
    TASK_COLUMNS.map((column) => [column.id, [] as TaskCard[]]),
  );
  const unplaced: TaskCard[] = [];
  for (const task of tasks) {
    const column = columnOf(task.state);
    if (column === null) {
      unplaced.push(task);
      continue;
    }
    buckets.get(column)?.push(task);
  }
  return {
    columns: TASK_COLUMNS.map((column) => ({ column, tasks: buckets.get(column.id) ?? [] })),
    unplaced,
  };
}

/** 任务状态的展示文案（卡片上的徽标）。 */
const TASK_STATE_TEXT: Record<TeamTaskState, string> = {
  pending: '待认领',
  claimed: '已认领',
  in_progress: '进行中',
  awaiting_approval: '待批准',
  done: '已完成',
  failed: '失败',
  blocked: '冻结',
  proposed: '待接受',
};

export function taskStateLabel(state: TeamTaskState): string {
  return TASK_STATE_TEXT[state];
}

/**
 * 工作区的展示文案（`Workspace` 是带数据的枚举，`worktree` 要看路径）。
 *
 * 只显示路径最后一段：完整绝对路径在窄面板里会挤掉标题，而分支/worktree 目录名对
 * 「两个成员是不是并行改同一个树」这个问题才是有信息的。
 */
export function workspaceLabel(workspace: Workspace): string {
  if (workspace === 'shared') return '共享工作区';
  if (workspace === 'read_only') return '只读';
  const path = workspace.worktree.path;
  const base = path.split(/[\\/]/).filter(Boolean).pop();
  return base ? `worktree ${base}` : 'worktree';
}

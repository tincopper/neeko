import type { TaskCard, TeamTaskState } from '@/shared/types/team';

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

/**
 * 状态 → 列的**映射表**（不是数组）。
 *
 * 这里刻意写成 `Record<TeamTaskState, TaskColumnId>`：后端新增一个 `TeamTaskState` 变体时，
 * `src/shared/types/team.ts` 的镜像一改，**这个对象就编不过**。写成
 * `[{ id, states: [...] }] + find()` 时漏一个变体不会编译失败，它只会静默落进
 * `unplaced` —— 而 `unplaced` 是面板不渲染的那一堆，症状是「队长派了活，板上没有」。
 */
const COLUMN_OF: Record<TeamTaskState, TaskColumnId> = {
  // `proposed` 与 `pending` 同列：都是「还没人干活」，只是 proposed 还多了「等队长 accept」。
  pending: 'pending',
  proposed: 'pending',
  // `claimed` 与 `in_progress` 是同一件事的两个阶段：起了租约 / 收到首轮 TurnStart。
  claimed: 'in_progress',
  in_progress: 'in_progress',
  awaiting_approval: 'awaiting_approval',
  done: 'done',
  // 两者对队长的动作相同（人工介入），但卡片上仍分别标注。
  failed: 'frozen',
  blocked: 'frozen',
};

/** 列的**顺序**（纯展示顺序，与映射表分开维护）。 */
export const TASK_COLUMN_ORDER: readonly TaskColumnId[] = [
  'pending',
  'in_progress',
  'awaiting_approval',
  'done',
  'frozen',
];

const COLUMN_LABEL: Record<TaskColumnId, string> = {
  pending: '待认领',
  in_progress: '进行中',
  awaiting_approval: '待批准',
  done: '已完成',
  frozen: '阻塞',
};

/** 五列（顺序来自 [`TASK_COLUMN_ORDER`]；每列的 `states` 由映射表反查，不另写一份）。 */
export const TASK_COLUMNS: readonly TaskColumn[] = TASK_COLUMN_ORDER.map((id) => ({
  id,
  label: COLUMN_LABEL[id],
  states: (Object.keys(COLUMN_OF) as TeamTaskState[]).filter((state) => COLUMN_OF[state] === id),
}));

/**
 * 状态 → 列。
 *
 * 返回类型里保留 `null` 只为**运行时**兜底：类型层面已经穷尽（见 [`COLUMN_OF`]），但后端
 * 可能比前端先发一个尚未镜像的新状态，那时宁可把它挑出来（`unplaced`）也不要静默丢弃。
 */
export function columnOf(state: TeamTaskState): TaskColumnId | null {
  return COLUMN_OF[state] ?? null;
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
 * 「重试」动作的**唯一**判据（看板卡片与任务详情共用）。
 *
 * 只有 `failed`（成员显式声明失败）与 `blocked`（回收超限的冻结态）能重试：
 * 前者是「这一轮没做成」，后者已经对自动回收永久关闭 —— 人工重试是它唯一的出路。
 * `done` 是终态（重开等于撤销「完成」声明，正确动作是建新任务并声明依赖）；
 * 其余在飞态不是「失败了」。与后端 `manager::retry_task` 的状态门**同源**：
 * 后端集合变了，这里先在 `canRetry` 的 8 态穷尽测试里红。
 */
export function canRetry(state: TeamTaskState): boolean {
  return state === 'failed' || state === 'blocked';
}

/**
 * 待批的任务数（面板头部的「M 待批」）。
 *
 * 与「列的计数」**同源但不同用途**：列计数是「这一列有几行」，这里是「有多少条活在等人动手」。
 * 它必须从同一份 `tasks` 数出来 —— 另存一个计数器就是第二份真相（脉冲刷新时必然漂移）。
 */
export function awaitingApprovalCount(tasks: readonly TaskCard[]): number {
  return tasks.filter((task) => task.state === 'awaiting_approval').length;
}

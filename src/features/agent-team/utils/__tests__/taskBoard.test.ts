import { describe, expect, it } from 'vitest';

import type { TeamTaskState } from '@/shared/types/team';
import { createTaskCard } from '@/testing/factories';

import {
  TASK_COLUMNS,
  TASK_COLUMN_ORDER,
  awaitingApprovalCount,
  buildTaskBoard,
  columnOf,
  taskStateLabel,
} from '../taskBoard';
import { workspaceLabel } from '../workspaceLabel';

/**
 * 任务板分列。
 *
 * 最关键的一条是**枚举闭合**：后端 `TeamTaskState` 的每一个变体都必须落在某一列里。
 * 漏一个（比如 `claimed`）的症状是「队长派了活，任务板是空的」—— 而且只有那一瞬间
 * （首轮 TurnStart 之前）为空，所以肉眼极难复现。
 */
const ALL_TASK_STATES: TeamTaskState[] = [
  'pending',
  'claimed',
  'in_progress',
  'awaiting_approval',
  'done',
  'failed',
  'blocked',
  'proposed',
];

describe('columnOf — 状态到列的映射', () => {
  it('每个任务状态都有列（漏一个 = 静默丢任务）', () => {
    for (const state of ALL_TASK_STATES) {
      // 带上 state 一起断言，失败时能直接看出漏了哪个变体。
      expect({ state, column: columnOf(state) }.column).not.toBeNull();
    }
  });

  it('claimed 与 in_progress 同列（刚认领的任务不许从板上消失）', () => {
    expect(columnOf('claimed')).toBe('in_progress');
    expect(columnOf('in_progress')).toBe('in_progress');
  });

  it('失败与冻结（blocked）同列，各自仍可区分', () => {
    expect(columnOf('failed')).toBe('frozen');
    expect(columnOf('blocked')).toBe('frozen');
    expect(taskStateLabel('failed')).not.toBe(taskStateLabel('blocked'));
  });

  it('列顺序是常量（映射表与展示顺序分开维护，新增一列不会打乱既有顺序）', () => {
    expect(TASK_COLUMNS.map((column) => column.id)).toEqual([...TASK_COLUMN_ORDER]);
    // 每列的 `states` 由映射表反查得出，所以「列里有哪些状态」与 `columnOf` 恒一致
    for (const column of TASK_COLUMNS) {
      for (const state of column.states) {
        expect({ state, column: columnOf(state) }.column).toBe(column.id);
      }
    }
  });

  it('proposed 与 pending 同列（都是「还没人干活」）', () => {
    expect(columnOf('proposed')).toBe('pending');
    expect(columnOf('done')).toBe('done');
    expect(columnOf('awaiting_approval')).toBe('awaiting_approval');
  });
});

describe('buildTaskBoard', () => {
  it('按列分组且保持后端给的顺序', () => {
    const board = buildTaskBoard([
      createTaskCard({ id: 't1', state: 'pending' }),
      createTaskCard({ id: 't2', state: 'in_progress' }),
      createTaskCard({ id: 't3', state: 'in_progress' }),
      createTaskCard({ id: 't4', state: 'done' }),
    ]);

    expect(board.columns.map((c) => c.column.id)).toEqual(TASK_COLUMNS.map((c) => c.id));
    const inProgress = board.columns.find((c) => c.column.id === 'in_progress');
    expect(inProgress?.tasks.map((t) => t.id)).toEqual(['t2', 't3']);
    expect(board.unplaced).toEqual([]);
  });

  it('空板：五列都在，行数为零（列不会因为空而消失）', () => {
    const board = buildTaskBoard([]);
    expect(board.columns).toHaveLength(TASK_COLUMNS.length);
    expect(board.columns.every((column) => column.tasks.length === 0)).toBe(true);
  });
});

describe('workspaceLabel', () => {
  it('区分共享 / 只读 / worktree', () => {
    expect(workspaceLabel('shared')).toBe('共享工作区');
    expect(workspaceLabel('read_only')).toBe('只读');
    expect(workspaceLabel({ worktree: { path: '/tmp/wt-a' } })).toBe('worktree wt-a');
  });
});

describe('awaitingApprovalCount', () => {
  it('只数 awaiting_approval（待批 ≠ 进行中 ≠ 阻塞）', () => {
    const tasks = [
      createTaskCard({ id: 't1', state: 'awaiting_approval' }),
      createTaskCard({ id: 't2', state: 'awaiting_approval' }),
      createTaskCard({ id: 't3', state: 'in_progress' }),
      createTaskCard({ id: 't4', state: 'blocked' }),
      createTaskCard({ id: 't5', state: 'done' }),
    ];
    expect(awaitingApprovalCount(tasks)).toBe(2);
    expect(awaitingApprovalCount([])).toBe(0);
  });
});

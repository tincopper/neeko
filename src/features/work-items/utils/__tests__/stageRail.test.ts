import { describe, expect, it } from 'vitest';

import { canMove, stageNodes } from '../stageRail';
import type { StagePlan } from '../types';

/** 与后端 `StagePlan::default()` 同形：5 个阶段、只连相邻两两（双向）。 */
const PLAN: StagePlan = {
  stages: ['Backlog', 'Ready', 'In Progress', 'Review', 'Done'],
  transitions: [
    { from: 'Backlog', to: 'Ready' },
    { from: 'Ready', to: 'Backlog' },
    { from: 'Ready', to: 'In Progress' },
    { from: 'In Progress', to: 'Ready' },
    { from: 'In Progress', to: 'Review' },
    { from: 'Review', to: 'In Progress' },
    { from: 'Review', to: 'Done' },
    { from: 'Done', to: 'Review' },
  ],
};

describe('canMove', () => {
  it('相邻两个方向都允许', () => {
    expect(canMove(PLAN, 'Ready', 'In Progress')).toBe(true);
    expect(canMove(PLAN, 'In Progress', 'Ready')).toBe(true);
  });

  it('跨阶段被拒绝（需要先经过中间阶段）', () => {
    expect(canMove(PLAN, 'Backlog', 'Done')).toBe(false);
    expect(canMove(PLAN, 'Backlog', 'In Progress')).toBe(false);
  });

  it('同一个 stage 不算流转', () => {
    expect(canMove(PLAN, 'Ready', 'Ready')).toBe(false);
  });

  it('未知来源 stage 一律拒绝', () => {
    expect(canMove(PLAN, 'Archive', 'Ready')).toBe(false);
  });

  it('transitions 由后端下发 —— 跳级被后端允许时前端自动跟随', () => {
    const jumpPlan: StagePlan = {
      stages: ['A', 'B', 'C'],
      transitions: [{ from: 'A', to: 'C' }],
    };
    expect(canMove(jumpPlan, 'A', 'C')).toBe(true);
  });
});

describe('stageNodes', () => {
  it('当前 stage 是 current，相邻是 reachable，其余 locked', () => {
    expect(stageNodes(PLAN, 'In Progress')).toEqual([
      { stage: 'Backlog', status: 'locked' },
      { stage: 'Ready', status: 'reachable' },
      { stage: 'In Progress', status: 'current' },
      { stage: 'Review', status: 'reachable' },
      { stage: 'Done', status: 'locked' },
    ]);
  });

  it('首尾只各有一个相邻节点', () => {
    expect(stageNodes(PLAN, 'Backlog').map((n) => n.status)).toEqual([
      'current',
      'reachable',
      'locked',
      'locked',
      'locked',
    ]);
    expect(stageNodes(PLAN, 'Done').map((n) => n.status)).toEqual([
      'locked',
      'locked',
      'locked',
      'reachable',
      'current',
    ]);
  });

  it('当前 stage 不在 plan 里时一个 current 都没有（不猜位置）', () => {
    expect(stageNodes(PLAN, 'Archive').some((n) => n.status === 'current')).toBe(false);
  });

  it('节点顺序与 plan.stages 一致（不是按 status 排序）', () => {
    expect(stageNodes(PLAN, 'Review').map((n) => n.stage)).toEqual(PLAN.stages);
  });
});

// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createTaskCard } from '@/testing/factories';

import { FLOW_LEAD_ID, flowLayout } from '../flowLayout';

/**
 * 分配 flow 图的布局判据。
 *
 * 图是快照的**投影**：任务按 `dependsOn` 拓扑分层（依赖在上、被依赖在下……反了就等于
 * 把因果画反），成员按「它认领的任务最早出现在板的哪一行」排进底行。所有输入都来自
 * 既有快照字段，零新增 IPC。
 */
describe('flowLayout', () => {
  it('places independent tasks in layer 0 and dependents one layer below their deepest dependency', () => {
    const tasks = [
      createTaskCard({ id: 't2' }),
      createTaskCard({ id: 't1' }),
      createTaskCard({ id: 't3', dependsOn: ['t1'] }),
      createTaskCard({ id: 't4', dependsOn: ['t1', 't3'] }),
    ];
    const layout = flowLayout(tasks, []);
    expect(layout.layers).toEqual([['t2', 't1'], ['t3'], ['t4']]);
  });

  it('ignores dependencies that are not on the listed board instead of crashing', () => {
    // 列载荷有上界（MAX_BOARD_TASKS = 200）：被截断的板可能不含某个依赖。
    // 缺失的依赖不是数据损坏，只是「不在这一次载荷里」—— 分层照常进行。
    const tasks = [createTaskCard({ id: 't1', dependsOn: ['t0-missing'] })];
    const layout = flowLayout(tasks, []);
    expect(layout.layers).toEqual([['t1']]);
  });

  it('survives a dependency cycle instead of recursing forever', () => {
    // 后端不校验 create 时的环（claim 时才被「未全 done 不可 claim」卡住），所以布局
    // 函数必须自己兜住。环内任务的**具体层号是任意的**（本来就没有一致解），判据只有
    // 两条：终止（不栈溢出）+ 每个任务都还在图里。
    const tasks = [
      createTaskCard({ id: 't1', dependsOn: ['t2'] }),
      createTaskCard({ id: 't2', dependsOn: ['t1'] }),
    ];
    const layout = flowLayout(tasks, []);
    expect(layout.layers.flat().sort()).toEqual(['t1', 't2']);
    expect(layout.layers.length).toBeLessThanOrEqual(tasks.length);
  });

  it('画出完整的三层关系：lead 派发每个任务 + 依赖 + 成员认领', () => {
    const tasks = [
      createTaskCard({ id: 't1', owner: 'w1@tm', state: 'in_progress' }),
      createTaskCard({ id: 't2', owner: 'w2@tm', state: 'done' }),
      createTaskCard({ id: 't3', dependsOn: ['t1'] }),
    ];
    const layout = flowLayout(tasks, []);
    // create 边：**每个任务都由 lead 派发**（这是「一个需求拆成哪些任务」的那条线）。
    expect(layout.dispatched).toEqual(['t1', 't2', 't3']);
    expect(layout.edges).toEqual([
      { kind: 'create', from: FLOW_LEAD_ID, to: 't1' },
      { kind: 'create', from: FLOW_LEAD_ID, to: 't2' },
      { kind: 'create', from: FLOW_LEAD_ID, to: 't3' },
      { kind: 'dep', from: 't1', to: 't3' },
      { kind: 'claim', from: 'w1@tm', to: 't1' },
      { kind: 'claim', from: 'w2@tm', to: 't2' },
    ]);
  });

  it('成员行按角色分组：同 persona 相邻，无人设排在后面但仍可见', () => {
    const tasks = [
      createTaskCard({ id: 't1', owner: 'r1@tm', state: 'in_progress' }),
      createTaskCard({ id: 't2', owner: 'i1@tm', state: 'in_progress' }),
      createTaskCard({ id: 't3', owner: 'r2@tm', state: 'in_progress' }),
    ];
    const members = [
      { memberId: 'r1@tm', name: 'r1', persona: '研究员', agentId: 'pi' },
      { memberId: 'i1@tm', name: 'i1', persona: '实现者', agentId: 'codex' },
      { memberId: 'r2@tm', name: 'r2', persona: '研究员', agentId: 'pi' },
      { memberId: 'x@tm', name: 'x', persona: null, agentId: 'pi' },
    ] as never[];
    const layout = flowLayout(tasks, members);

    // 同角色相邻（r1/r2 挨着），无角色的排最后。
    expect(layout.memberRow).toEqual(['i1@tm', 'r1@tm', 'r2@tm', 'x@tm']);
    // 每个成员带自己的角色与任务数 —— 「分工是否合理」靠这两列判断。
    const byId = new Map(layout.workerRow.map((w) => [w.memberId, w]));
    expect(byId.get('r1@tm')).toEqual({ memberId: 'r1@tm', persona: '研究员', taskCount: 1 });
    expect(byId.get('x@tm')).toEqual({ memberId: 'x@tm', persona: null, taskCount: 0 });
  });

  it('orders the member row by the earliest board index of the tasks they own, name-last for the idle', () => {
    const tasks = [
      createTaskCard({ id: 't1', owner: 'w1@tm', state: 'in_progress' }),
      createTaskCard({ id: 't2', owner: 'w2@tm', state: 'in_progress' }),
    ];
    const members = [
      { memberId: 'w2@tm', name: 'w2' },
      { memberId: 'w3@tm', name: 'w3' },
      { memberId: 'w1@tm', name: 'w1' },
    ] as never[];
    const layout = flowLayout(tasks, members);
    // w1 的 t1 在板上更早 → w1 排前面；空闲的 w3 按名字排最后。
    expect(layout.memberRow).toEqual(['w1@tm', 'w2@tm', 'w3@tm']);
  });

  it('keeps members that own nothing visible, and tasks with no owner still listed', () => {
    const tasks = [createTaskCard({ id: 't1', owner: null, state: 'pending' })];
    const layout = flowLayout(tasks, [{ memberId: 'w1@tm', name: 'w1' }] as never[]);
    expect(layout.layers).toEqual([['t1']]);
    expect(layout.memberRow).toEqual(['w1@tm']);
    // 没有认领边，但**有** lead 的派发边（任务已被规划出来，只是还没人接）。
    expect(layout.edges).toEqual([{ kind: 'create', from: FLOW_LEAD_ID, to: 't1' }]);
    expect(layout.workerRow[0].taskCount).toBe(0);
  });

  it('handles an empty board', () => {
    const layout = flowLayout([], []);
    expect(layout.layers).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.memberRow).toEqual([]);
  });
});

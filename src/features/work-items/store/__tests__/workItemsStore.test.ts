/**
 * `workItemsStore`：Tasks 面板的状态面。
 *
 * 只 mock **api 层**（`../api/workItemsApi`），不 mock `invoke` —— IPC 形状是 `workItemsApi.test.ts`
 * 的职责，这里钉的是「状态怎么变」：槽位语义（`undefined` vs `[]`）、乐观更新的落地与回滚、
 * 撤销窗口的延迟提交、并发去重。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getStagePlan: vi.fn(),
  listWorkItems: vi.fn(),
  createWorkItem: vi.fn(),
  updateWorkItem: vi.fn(),
  transitionWorkItem: vi.fn(),
  deleteWorkItem: vi.fn(),
}));

vi.mock('../../api/workItemsApi', () => api);

import type { StagePlan, WorkItem } from '../../types';
import { useWorkItemsStore } from '../workItemsStore';

const PLAN: StagePlan = {
  stages: ['Backlog', 'Ready', 'In Progress', 'Review', 'Done'],
  transitions: [
    { from: 'Backlog', to: 'Ready' },
    { from: 'Ready', to: 'Backlog' },
    { from: 'Ready', to: 'In Progress' },
    { from: 'In Progress', to: 'Ready' },
  ],
};

/** 与后端同形的样本行；默认锚在 `p1` 的 Backlog。 */
function item(id: string, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    projectId: 'p1',
    title: `title ${id}`,
    body: '',
    stage: 'Backlog',
    priority: null,
    labels: [],
    assignee: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function state() {
  return useWorkItemsStore.getState();
}

function ids(projectId = 'p1'): string[] {
  return (state().itemsByProject[projectId] ?? []).map((row) => row.id);
}

function reset(): void {
  state().reset();
  api.getStagePlan.mockReset();
  api.listWorkItems.mockReset();
  api.createWorkItem.mockReset();
  api.updateWorkItem.mockReset();
  api.transitionWorkItem.mockReset();
  api.deleteWorkItem.mockReset();
  api.getStagePlan.mockResolvedValue(PLAN);
  api.listWorkItems.mockResolvedValue([]);
  api.deleteWorkItem.mockResolvedValue(undefined);
}

describe('workItemsStore — 列表槽位', () => {
  beforeEach(reset);

  it('load 成功按项目分槽填充', async () => {
    const rows = [item('wi_1'), item('wi_2', { projectId: 'p2' })];
    api.listWorkItems.mockImplementation(async (projectId: string) =>
      rows.filter((row) => row.projectId === projectId),
    );

    await state().load('p1');
    await state().load('p2');

    expect(state().itemsByProject.p1).toEqual([item('wi_1')]);
    expect(state().itemsByProject.p2).toEqual([item('wi_2', { projectId: 'p2' })]);
    expect(state().loading).toEqual({ p1: false, p2: false });
    expect(state().errors).toEqual({ p1: null, p2: null });
  });

  it('空列表写入 [] 而不是留 undefined（「加载过但为空」≠「还没加载」）', async () => {
    api.listWorkItems.mockResolvedValue([]);

    await state().load('p1');

    expect(state().itemsByProject.p1).toBeInstanceOf(Array);
    expect(state().itemsByProject.p1).toEqual([]);
    expect(state().itemsByProject.p2).toBeUndefined();
  });

  it('load 失败保留旧列表并写 errors（闪空比旧数据更糟）', async () => {
    api.listWorkItems.mockResolvedValueOnce([item('wi_1')]);
    await state().load('p1');

    api.listWorkItems.mockRejectedValueOnce(new Error('Storage error: db locked'));
    await state().load('p1');

    expect(state().itemsByProject.p1).toEqual([item('wi_1')]);
    expect(state().errors.p1).toBe('Storage error: db locked');
    expect(state().loading.p1).toBe(false);
  });

  it('下一次成功 load 清掉错误位', async () => {
    api.listWorkItems.mockRejectedValueOnce(new Error('boom'));
    await state().load('p1');
    expect(state().errors.p1).toBe('boom');

    api.listWorkItems.mockResolvedValueOnce([item('wi_1')]);
    await state().load('p1');

    expect(state().errors.p1).toBeNull();
    expect(ids()).toEqual(['wi_1']);
  });

  it('后端拒绝一个没有 message 的对象时也不写 [object Object]', async () => {
    // 形状兜底：`invokeErrorMessage` 会把 `String({})` 判成「没有消息」，
    // 此时对象的 `message` 才是唯一有用的信息。
    api.listWorkItems.mockRejectedValueOnce({ message: 'Not found: wi_9' });

    await state().load('p1');

    expect(state().errors.p1).toBe('Not found: wi_9');
  });

  it('错误体里什么都读不出来时用 fallback（不把对象抹成文本）', async () => {
    api.listWorkItems.mockRejectedValueOnce({ code: 500 });

    await state().load('p1');

    // 三段都失败（非字符串 / 非 Error / `String` 后仍是 `[object Object]` / 无 message）
    expect(state().errors.p1).toBe('Could not load the work items');
  });

  it('同项目并发两次 load 只发一次请求（第二次拿到同一个 Promise）', async () => {
    let resolve!: (rows: WorkItem[]) => void;
    api.listWorkItems.mockImplementation(
      () =>
        new Promise<WorkItem[]>((r) => {
          resolve = r;
        }),
    );

    const first = state().load('p1');
    const second = state().load('p1');

    expect(api.listWorkItems).toHaveBeenCalledTimes(1);
    expect(state().loading.p1).toBe(true);

    resolve([item('wi_1')]);
    await Promise.all([first, second]);

    expect(state().itemsByProject.p1).toEqual([item('wi_1')]);
    expect(state().loading.p1).toBe(false);
    // 落地后再拉才算新的一次请求
    api.listWorkItems.mockResolvedValue([]);
    await state().load('p1');
    expect(api.listWorkItems).toHaveBeenCalledTimes(2);
  });
});

describe('workItemsStore — 流转', () => {
  beforeEach(reset);

  it('乐观更新立刻改 stage 并把 updatedAt 提到「现在」', async () => {
    api.listWorkItems.mockResolvedValue([
      item('wi_2', { updatedAt: 20 }),
      item('wi_1', { stage: 'Ready', updatedAt: 10 }),
    ]);
    await state().load('p1');

    let resolve!: (row: WorkItem) => void;
    api.transitionWorkItem.mockImplementation(
      () =>
        new Promise<WorkItem>((r) => {
          resolve = r;
        }),
    );

    const pending = state().transition('wi_1', 'In Progress', 'p1');

    // 还没等 IPC 回来：已经换列并置顶
    expect(ids()).toEqual(['wi_1', 'wi_2']);
    expect(state().itemsByProject.p1?.[0].stage).toBe('In Progress');
    expect(state().itemsByProject.p1?.[0].updatedAt).toBeGreaterThan(20);

    resolve(item('wi_1', { stage: 'In Progress', updatedAt: 30 }));
    await pending;
  });

  it('成功时用后端返回值覆盖本地项（后端是真相源）', async () => {
    api.listWorkItems.mockResolvedValue([item('wi_1', { stage: 'Ready', updatedAt: 10 })]);
    await state().load('p1');
    // 后端返回的 updatedAt 与本地占位值不同，最终必须是后端那个
    api.transitionWorkItem.mockResolvedValue(item('wi_1', { stage: 'Review', updatedAt: 777 }));

    await state().transition('wi_1', 'In Progress', 'p1');

    expect(state().itemsByProject.p1?.[0]).toMatchObject({ stage: 'Review', updatedAt: 777 });
  });

  it('失败回滚到原始项与原始位置，并把错误抛给调用方', async () => {
    // 三条，且被流转的是**中间**那条：只有这样才能区分「插回原索引」与「追加到末尾」
    // （两条列表里 index 1 恰好就是末尾，两种实现会同时变绿）。
    api.listWorkItems.mockResolvedValue([
      item('wi_3', { updatedAt: 30 }),
      item('wi_2', { stage: 'Ready', updatedAt: 20 }),
      item('wi_1', { updatedAt: 10 }),
    ]);
    await state().load('p1');
    api.transitionWorkItem.mockRejectedValue(new Error('Invalid input: cannot move to Done'));

    await expect(state().transition('wi_2', 'Done', 'p1')).rejects.toThrow(
      'Invalid input: cannot move to Done',
    );

    // 位置与 stage 都回到原样（不是「留在顶部 + 旧 stage」，也不是「回到末尾」）
    expect(ids()).toEqual(['wi_3', 'wi_2', 'wi_1']);
    expect(state().itemsByProject.p1?.[1]).toEqual(item('wi_2', { stage: 'Ready', updatedAt: 20 }));
  });

  it('失败且本地没有这一行时：回滚整段跳过，错误照样抛给调用方', async () => {
    // 「能发起 transition 就说明列表加载过」，但那一行可能已经不在本地了（另一个窗口删掉、
    // 或撤销窗口把这个 id 藏起来了）。此时回滚没有对象 —— 不能因此把错误吞掉。
    api.listWorkItems.mockResolvedValue([]);
    await state().load('p1');
    api.transitionWorkItem.mockRejectedValue(new Error('NotFound: work item `wi_404`'));

    await expect(state().transition('wi_404', 'Ready', 'p1')).rejects.toThrow('NotFound');

    expect(state().itemsByProject.p1).toEqual([]);
  });

  it('槽位未加载时不凭空造一个「只有一条」的列表（只写已加载过的槽位）', async () => {
    api.transitionWorkItem.mockResolvedValue(item('wi_1', { stage: 'Ready' }));

    await state().transition('wi_1', 'Ready', 'p1');

    // 凭空造槽位会把「未加载」变成「已加载但不全」—— 面板会以为这就是全部
    expect(state().itemsByProject.p1).toBeUndefined();
  });
});

describe('workItemsStore — 创建与更新', () => {
  beforeEach(reset);

  it('create 插到列表最前', async () => {
    api.listWorkItems.mockResolvedValue([item('wi_1', { updatedAt: 20 })]);
    await state().load('p1');
    api.createWorkItem.mockResolvedValue(item('wi_new', { updatedAt: 30 }));

    const created = await state().create({ projectId: 'p1', title: 'new' });

    expect(created.id).toBe('wi_new');
    expect(ids()).toEqual(['wi_new', 'wi_1']);
    expect(api.listWorkItems).toHaveBeenCalledTimes(1); // 没有重拉整表
  });

  it('create 在槽位还没加载过时也落一行（新卡片必须立刻出现）', async () => {
    api.createWorkItem.mockResolvedValue(item('wi_new'));

    await state().create({ projectId: 'p1', title: 'new' });

    expect(ids()).toEqual(['wi_new']);
  });

  it('update 就地替换并置顶，updatedAt 取后端返回值', async () => {
    api.listWorkItems.mockResolvedValue([
      item('wi_1', { updatedAt: 20 }),
      item('wi_2', { updatedAt: 10 }),
    ]);
    await state().load('p1');
    api.updateWorkItem.mockResolvedValue(item('wi_2', { title: 'renamed', updatedAt: 55 }));

    await state().update({ id: 'wi_2', title: 'renamed' });

    expect(ids()).toEqual(['wi_2', 'wi_1']);
    expect(state().itemsByProject.p1?.[0]).toMatchObject({ title: 'renamed', updatedAt: 55 });
    expect(api.listWorkItems).toHaveBeenCalledTimes(1); // 没有重拉整表
  });

  it('update 失败不改动列表并抛出', async () => {
    api.listWorkItems.mockResolvedValue([item('wi_1', { updatedAt: 20 })]);
    await state().load('p1');
    api.updateWorkItem.mockRejectedValue(new Error('Invalid input: `title` must not be empty'));

    await expect(state().update({ id: 'wi_1', title: '' })).rejects.toThrow(
      '`title` must not be empty',
    );

    expect(state().itemsByProject.p1).toEqual([item('wi_1', { updatedAt: 20 })]);
  });
});

describe('workItemsStore — 删除与撤销窗口', () => {
  beforeEach(reset);

  it('deleteWithUndo 立刻从本地消失，5000ms 后才真的调用删除', async () => {
    vi.useFakeTimers();
    api.listWorkItems.mockResolvedValue([item('wi_1', { updatedAt: 20 })]);
    await state().load('p1');

    await state().deleteWithUndo('wi_1', 'p1');

    expect(ids()).toEqual([]);
    expect(api.deleteWorkItem).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4999);
    expect(api.deleteWorkItem).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(api.deleteWorkItem).toHaveBeenCalledTimes(1);
    expect(api.deleteWorkItem).toHaveBeenCalledWith('wi_1');
  });

  it('窗口内撤销：放回原索引、删除一次都没提交、返回 true', async () => {
    vi.useFakeTimers();
    api.listWorkItems.mockResolvedValue([
      item('wi_1', { updatedAt: 30 }),
      item('wi_2', { updatedAt: 20 }),
      item('wi_3', { updatedAt: 10 }),
    ]);
    await state().load('p1');

    await state().deleteWithUndo('wi_2', 'p1');
    expect(ids()).toEqual(['wi_1', 'wi_3']);

    expect(state().undoDelete('p1')).toBe(true);
    expect(ids()).toEqual(['wi_1', 'wi_2', 'wi_3']);

    await vi.advanceTimersByTimeAsync(5000);
    expect(api.deleteWorkItem).not.toHaveBeenCalled();
  });

  it('窗口外撤销：返回 false 且不恢复', async () => {
    vi.useFakeTimers();
    api.listWorkItems.mockResolvedValue([item('wi_1', { updatedAt: 20 })]);
    await state().load('p1');

    await state().deleteWithUndo('wi_1', 'p1');
    await vi.advanceTimersByTimeAsync(5000);

    expect(api.deleteWorkItem).toHaveBeenCalledTimes(1);
    expect(state().undoDelete('p1')).toBe(false);
    expect(ids()).toEqual([]);
  });

  it('撤销只作用于本项目：别的项目有窗口时不会被误撤', async () => {
    vi.useFakeTimers();
    api.listWorkItems.mockImplementation(async (projectId: string) =>
      projectId === 'p1' ? [item('wi_1')] : [item('wi_9', { projectId: 'p2' })],
    );
    await state().load('p1');
    await state().load('p2');

    await state().deleteWithUndo('wi_1', 'p1');

    expect(state().undoDelete('p2')).toBe(false);
    expect(ids()).toEqual([]);
  });

  it('连点删除同一行不会提交两次', async () => {
    vi.useFakeTimers();
    api.listWorkItems.mockResolvedValue([item('wi_1', { updatedAt: 20 })]);
    await state().load('p1');

    await state().deleteWithUndo('wi_1', 'p1');
    await state().deleteWithUndo('wi_1', 'p1');
    await vi.advanceTimersByTimeAsync(5000);

    expect(api.deleteWorkItem).toHaveBeenCalledTimes(1);
  });

  it('窗口内刷新让行复活后再删一次：旧窗口被收掉，只提交一次', async () => {
    // 上一条用例走的是 `index < 0` 早退（行已经不在本地列表里），它证明不了
    // 「连点删除：先收掉旧窗口」那段代码 —— 而那段只有在行被 `load` 拉回本地后才生效：
    // 后端在 5 秒窗口内**仍有这一行**，所以手动刷新会让它重新出现在列表里。
    vi.useFakeTimers();
    api.listWorkItems.mockResolvedValue([item('wi_1', { updatedAt: 20 })]);
    await state().load('p1');

    await state().deleteWithUndo('wi_1', 'p1'); // 窗口 A
    await state().load('p1');
    expect(ids()).toEqual(['wi_1']); // 后端还没删 → 刷新即复活

    await state().deleteWithUndo('wi_1', 'p1'); // 窗口 B（必须收掉 A）
    await vi.advanceTimersByTimeAsync(5000);

    // 没有收掉 A 时两个钟同时到点 → 2 次提交，第二次必然 NotFound
    expect(api.deleteWorkItem).toHaveBeenCalledTimes(1);
  });

  it('延迟提交失败：行放回原位并写错误位（窗口已关，用户只能靠这句话理解）', async () => {
    vi.useFakeTimers();
    api.listWorkItems.mockResolvedValue([
      item('wi_1', { updatedAt: 20 }),
      item('wi_2', { updatedAt: 10 }),
    ]);
    await state().load('p1');
    api.deleteWorkItem.mockRejectedValue(new Error('NotFound: work item `wi_2` is not stored'));

    await state().deleteWithUndo('wi_2', 'p1');
    await vi.advanceTimersByTimeAsync(5000);

    expect(ids()).toEqual(['wi_1', 'wi_2']);
    expect(state().errors.p1).toBe('NotFound: work item `wi_2` is not stored');
  });

  it('reset 收掉所有撤销窗口（定时器不许在测试或项目切换后开火）', async () => {
    vi.useFakeTimers();
    api.listWorkItems.mockResolvedValue([item('wi_1', { updatedAt: 20 })]);
    await state().load('p1');
    await state().deleteWithUndo('wi_1', 'p1');

    state().reset();
    await vi.advanceTimersByTimeAsync(5000);

    expect(api.deleteWorkItem).not.toHaveBeenCalled();
    expect(state().itemsByProject).toEqual({});
    expect(state().undoDelete('p1')).toBe(false);
  });

  it('槽位还没加载过时 deleteWithUndo 早退：不发删除、也不凭空造槽位', async () => {
    // `?? []` 的那一半：从没 `load` 过这个项目 ⇒ 没有列表可改，也就没有可撤销的东西。
    vi.useFakeTimers();

    await state().deleteWithUndo('wi_1', 'p1');
    await vi.advanceTimersByTimeAsync(5000);

    expect(api.deleteWorkItem).not.toHaveBeenCalled();
    expect(state().itemsByProject.p1).toBeUndefined();
    expect(state().undoDelete('p1')).toBe(false);
  });

  it('本地没有这一行时不发删除请求（没有可撤销的东西）', async () => {
    vi.useFakeTimers();
    api.listWorkItems.mockResolvedValue([]);
    await state().load('p1');

    await state().deleteWithUndo('wi_404', 'p1');
    await vi.advanceTimersByTimeAsync(5000);

    expect(api.deleteWorkItem).not.toHaveBeenCalled();
    expect(state().undoDelete('p1')).toBe(false);
  });
});

describe('workItemsStore — 阶段轨', () => {
  beforeEach(reset);

  it('loadPlan 全局只拉一次（已有 plan 直接复用）', async () => {
    await state().loadPlan();
    await state().loadPlan();

    expect(api.getStagePlan).toHaveBeenCalledTimes(1);
    expect(state().plan).toEqual(PLAN);
  });

  it('并发 loadPlan 只打一次 IPC', async () => {
    await Promise.all([state().loadPlan(), state().loadPlan()]);
    expect(api.getStagePlan).toHaveBeenCalledTimes(1);
  });

  it('拉不到时 plan 保持 null 且不抛（调用方据此不渲染轨道）', async () => {
    api.getStagePlan.mockRejectedValue(new Error('Unknown error: no handler'));

    await expect(state().loadPlan()).resolves.toBeUndefined();
    expect(state().plan).toBeNull();
    // 没有项目可归，所以不写按项目分的错误位
    expect(state().errors).toEqual({});
  });
});

/**
 * `reset()` 的 generation 守卫：**迟到的响应不许写进新会话的槽位**。
 *
 * 这是 spec（`frontend/state-management.md`「工作项 store 的异步纪律」§3.4）里写明的一条契约，
 * 而它是**唯一**一条没有测试的契约 —— 三种在飞请求（列表 / 阶段轨 / 延迟提交的删除）都各自
 * 持有一个 `mine !== generation` 分支。守卫被删掉时症状是「切项目后看见另一个项目的任务」，
 * 这类缺陷不会让任何值断言变红（旧值本来就是合法值），只能靠「响应回来之后槽位仍是空的」来钉。
 */
describe('workItemsStore — reset 与迟到响应', () => {
  beforeEach(reset);

  it('reset 之后落地的列表响应被丢弃（不写进新会话的槽位）', async () => {
    let resolve!: (rows: WorkItem[]) => void;
    api.listWorkItems.mockImplementation(
      () =>
        new Promise<WorkItem[]>((r) => {
          resolve = r;
        }),
    );

    const pending = state().load('p1');
    expect(state().loading.p1).toBe(true);

    state().reset();
    resolve([item('wi_1')]);
    await pending;

    expect(state().itemsByProject.p1).toBeUndefined();
    // 迟到的那次也不许把 `loading` 改回来（reset 已清空；残留 `true` 会让面板永远转圈）
    expect(state().loading).toEqual({});
  });

  it('reset 之后落地的列表**失败**也被丢弃（不写错误位、不改 loading）', async () => {
    let reject!: (err: unknown) => void;
    api.listWorkItems.mockImplementation(
      () =>
        new Promise<WorkItem[]>((_, r) => {
          reject = r;
        }),
    );

    const pending = state().load('p1');
    state().reset();
    reject(new Error('Storage error: db locked'));
    await pending;

    expect(state().errors).toEqual({});
    expect(state().itemsByProject).toEqual({});
  });

  it('reset 之后落地的阶段轨响应被丢弃', async () => {
    let resolve!: (plan: StagePlan) => void;
    api.getStagePlan.mockImplementation(
      () =>
        new Promise<StagePlan>((r) => {
          resolve = r;
        }),
    );

    const pending = state().loadPlan();
    state().reset();
    resolve(PLAN);
    await pending;

    expect(state().plan).toBeNull();
  });

  it('reset 之后回来的删除失败被丢弃（不放回行、不写错误位）', async () => {
    vi.useFakeTimers();
    api.listWorkItems.mockResolvedValue([item('wi_1', { updatedAt: 20 })]);
    await state().load('p1');

    let reject!: (err: unknown) => void;
    api.deleteWorkItem.mockImplementation(
      () =>
        new Promise<void>((_, r) => {
          reject = r;
        }),
    );

    await state().deleteWithUndo('wi_1', 'p1');
    // 窗口到点 → 真的发删除（在飞，还没回）
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.deleteWorkItem).toHaveBeenCalledTimes(1);

    // 在飞期间切项目 / 清空：这次失败已经不属于任何可见的列表
    state().reset();
    reject(new Error('Storage error: db locked'));
    await vi.advanceTimersByTimeAsync(0);

    expect(state().itemsByProject).toEqual({});
    expect(state().errors).toEqual({});
  });
});

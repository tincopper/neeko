import type { MemberStatusView, TaskCard } from '@/shared/types/team';

/**
 * 分配 flow 图的**布局纯函数**（快照的投影，不是新的真相源）。
 *
 * # 数据从哪来
 *
 * 全部来自既有快照字段：`dependsOn`（不变量 3：依赖未全 done 不可 claim）、`owner`
 * （不变量 1：认领后必有且只有一个）、`state`。零新增 IPC，红线 4 天然安全。
 *
 * # 分层规则
 *
 * 任务的层号 = 1 + 它最深依赖的层号（最长的依赖链决定深度）；无依赖落第 0 层。
 * 两个防御都是**必须**的：
 *
 * - **缺失依赖**：列载荷有上界（`MAX_BOARD_TASKS = 200`），被截断的板可能不含某个
 *   依赖。缺失不是数据损坏，只是「不在这一次载荷里」—— 当作无依赖落第 0 层。
 * - **环**：后端不校验 `task_create` 时的环（claim 时才被「未全 done 不可 claim」
 *   卡住）。布局函数必须自己兜住，否则一个环 = 栈溢出，整个面板白屏。
 *
 * 成员行按「它认领的任务最早出现在板的哪一行」排序（先派谁一目了然），空闲成员按
 * 名字排最后。
 */
export interface FlowEdge {
  /** `create` = lead 派发任务；`dep` = 任务间依赖；`claim` = 成员认领任务。 */
  kind: 'create' | 'dep' | 'claim';
  /** `create`/`dep`：任务 → 任务（create 的 from 是 lead 的哨兵 id）；`claim`：成员 → 任务。 */
  from: string;
  to: string;
}

/** lead 节点的哨兵 id（不是成员 id —— lead 行也可能是成员，但图上是三类节点之一）。 */
export const FLOW_LEAD_ID = '@lead';

/** 图上的一行成员（含角色，供「按角色分工是否合理」的判断）。 */
export interface FlowWorker {
  memberId: string;
  /** 角色名（persona）；`null` = 无人设 —— 「没按角色分工」正是要看得见的事。 */
  persona: string | null;
  /** 这个成员在图上认领的任务数（0 = 空闲/未被用）。 */
  taskCount: number;
}

export interface FlowLayout {
  /** `layers[i]` = 第 i 层的任务 id（按板的输入顺序稳定排序）。 */
  layers: string[][];
  /** lead → 首层任务的派发边（用户要看见「一个需求拆成了哪些任务」）。 */
  dispatched: string[];
  /** 底行成员（按角色分组：同角色相邻，便于读「谁负责什么」）。 */
  workerRow: FlowWorker[];
  /** 兼容旧字段：底行成员 id（与 `workerRow` 同序）。 */
  memberRow: string[];
  edges: FlowEdge[];
}

/** 一个任务的层号：1 + 最深依赖的层号；`visiting` 上的递归 = 环，按无依赖处理。 */
function layerOf(id: string, byId: Map<string, TaskCard>, memo: Map<string, number>): number {
  const cached = memo.get(id);
  if (cached !== undefined) return cached;
  memo.set(id, 0); // 环护栏：递归重入时按第 0 层返回
  const task = byId.get(id);
  let layer = 0;
  if (task) {
    for (const dep of task.dependsOn) {
      if (!byId.has(dep)) continue; // 截断板上的缺失依赖：当作无依赖
      layer = Math.max(layer, layerOf(dep, byId, memo) + 1);
    }
  }
  memo.set(id, layer);
  return layer;
}

/** 分配 flow 图的唯一布局实现（组件只渲染它，不再算第二遍）。 */
export function flowLayout(
  tasks: readonly TaskCard[],
  members: readonly MemberStatusView[],
): FlowLayout {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const memo = new Map<string, number>();

  const layers: string[][] = [];
  for (const task of tasks) {
    const layer = layerOf(task.id, byId, memo);
    (layers[layer] ??= []).push(task.id);
  }
  // 空洞只可能来自「依赖在截断板之外却把别的任务垫高」—— 不会发生（缺失依赖按 0 层算），
  // 但 `??=` 按需建层天然无洞；这里只是把可能存在的稀疏数组压实。
  const dense = layers.filter((layer) => layer !== undefined);

  // 三类边，顺序固定（create → dep → claim）：渲染时认领线压在依赖线上，且同一布局
  // 两次计算给出同一个边序（diff 不出噪音）。
  //
  // `create` 边是用户要的「一个需求 → 拆成哪些任务」：**每个任务都由 lead 派发**，
  // 所以每个任务都有一条来自 lead 的边；首层之外的任务同时还有 dep 边（依赖关系），
  // 两者不冲突 —— 一条说「谁派的」，一条说「谁等谁」。
  const edges: FlowEdge[] = [];
  const dispatched: string[] = [];
  for (const task of dense.flat()) {
    edges.push({ kind: 'create', from: FLOW_LEAD_ID, to: task });
    dispatched.push(task);
  }
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (byId.has(dep)) edges.push({ kind: 'dep', from: dep, to: task.id });
    }
  }
  // 认领边按**任务顺序**（不是成员顺序）：同一张图的边序稳定，且读起来是
  // 「t1 被谁认领、t2 被谁认领」而不是按人聚合。
  for (const task of tasks) {
    if (task.owner !== null) edges.push({ kind: 'claim', from: task.owner, to: task.id });
  }

  // 成员行：**按角色分组**（同 persona 相邻），组内按「最早持有的任务板序」再按名字；
  // 空闲成员排在组后 —— 「谁负责什么」在图上要能一眼扫出来。
  const firstIndex = new Map<string, number>();
  const taskCount = new Map<string, number>();
  tasks.forEach((task, index) => {
    if (task.owner === null) return;
    taskCount.set(task.owner, (taskCount.get(task.owner) ?? 0) + 1);
    if (!firstIndex.has(task.owner)) firstIndex.set(task.owner, index);
  });
  const workerRow: FlowWorker[] = members
    .map((member) => ({
      memberId: member.memberId,
      persona: member.persona ?? null,
      taskCount: taskCount.get(member.memberId) ?? 0,
    }))
    .sort((a, b) => {
      // ① 有角色的在前（无人设是「没按角色分工」的信号，排后但不藏）
      if ((a.persona === null) !== (b.persona === null)) return a.persona === null ? 1 : -1;
      // ② 同角色相邻
      const pa = a.persona ?? '';
      const pb = b.persona ?? '';
      if (pa !== pb) return pa < pb ? -1 : 1;
      // ③ 组内：先派活的在前，再按 id
      const ia = firstIndex.get(a.memberId) ?? Number.MAX_SAFE_INTEGER;
      const ib = firstIndex.get(b.memberId) ?? Number.MAX_SAFE_INTEGER;
      if (ia !== ib) return ia - ib;
      return a.memberId < b.memberId ? -1 : 1;
    });
  const memberRow = workerRow.map((worker) => worker.memberId);

  return { layers: dense, dispatched, workerRow, memberRow, edges };
}

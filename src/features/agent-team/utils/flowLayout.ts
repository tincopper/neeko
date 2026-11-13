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
 * 名字排最后。第 2 轮起图上暂不渲染这一行，但布局结果仍对外提供（见下方注释）。
 */
export interface FlowEdge {
  /** `create` = lead 派发任务；`dep` = 任务间依赖。 */
  kind: 'create' | 'dep';
  /** `create`：from 是 lead 的哨兵 id；`dep`：from 是上游任务 id。`to` 恒为任务 id。 */
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
  /** lead → **首层任务**的派发边（用户要看见「一个需求拆出了哪些入口任务」）。 */
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

  // 两类边，顺序固定（create → dep）：同一布局两次计算给出同一个边序（diff 不出噪音）。
  //
  // 派发这个动作只发生一次：队长拆出的是**入口任务**（layer 0）；下游任务由 `dependsOn`
  // 连到上游，`t2 ← t1 ← lead` 的因果链已经完整。给第 1 层及更深的任务再拉一条从 lead
  // 出发的曲线，它必须跨过整个第 0 层才能落到目标，会**穿过中间层节点**、与依赖边糊成
  // 一束（第 2 轮用户反馈 #2）。
  //
  // **没有 `claim` 边**（用户裁决）：谁该做由任务行上的 `assignee`（计划事实）/ `owner`
  // （执行事实）直接表达，再画一条成员→任务的实线只是把同一份信息投影第二遍，
  // 而且它与「谁该做」会给出两个可能不一致的答案。
  // 拷贝一份：不与 `layers[0]` 共享可变数组（消费者改一个不该悄悄改另一个）。
  const dispatched = [...(dense[0] ?? [])];
  const edges: FlowEdge[] = dispatched.map((task) => ({
    kind: 'create',
    from: FLOW_LEAD_ID,
    to: task,
  }));
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (byId.has(dep)) edges.push({ kind: 'dep', from: dep, to: task.id });
    }
  }

  // 成员行：**按角色分组**（同 persona 相邻），组内按「最早持有的任务板序」再按名字；
  // 空闲成员排在组后 —— 「谁负责什么」在图上要能一眼扫出来。
  //
  // 第 2 轮用户说「成员平铺在最下面，**先**不要了」：图上**暂不消费** `workerRow` /
  // `memberRow`，但纯计算与判据都保留（恢复只需在 `TeamFlowGraph` 加回一块 JSX）。
  // 不为「先不要」删掉一整套已测能力。
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

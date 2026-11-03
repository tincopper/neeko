/**
 * Local 工作项（Tasks 面板）的前端状态：按项目分槽的列表 + 阶段轨 + 乐观动作。
 *
 * # 为什么 `undefined` 与 `[]` 必须分开
 *
 * `itemsByProject[projectId] === undefined` 表示**还没加载过**，`=== []` 表示**加载过且为空**。
 * 把两者压成一个「空」，空项目就永远分不清「正在加载」和「一条都没有」—— 面板只能在二者之间
 * 猜，猜错的一端表现为「空态里转圈」或「明明有任务却说没有」。所以 `load` 成功**永远写入
 * `[]`**，失败**一个字段都不动**（`file/store.ts` 的「失败不清空」同一条纪律）。
 *
 * # 为什么 `transition` 用本地快照回滚，而不是重新拉列表
 *
 * 失败时重新 `load` 一次看起来最省事，代价是：①一次失败会顺带抹掉期间所有本地变更（另一行的
 * create、还开着的撤销窗口），②这次 `load` 自己也可能失败，于是「流转失败」变成一块空列表，
 * 用户拿到的解释与他刚才做的动作毫无关系。后端拒绝非法流转时**一个字段都没写**（`transition_at`
 * 先判 `can_transition`），所以进入 `await` 前的本地副本仍然精确 —— 回滚它比重新读一遍更便宜也更准。
 *
 * # 为什么删除是「延迟提交」而不是「先删再重建」
 *
 * 撤销窗口（PRD US-CRUD-6）里的项**仍然在后端**：本地只是先把它藏起来，5 秒后才真的发
 * `work_item_delete`。反过来做（立刻删、撤销时 `create` 回来）会得到新的 `id` 与新的 `createdAt`，
 * 那是**偷偷改数据** —— 列表顺序变了、执行记录（`work_item_run.work_item_id` 外键）指向的行直接
 * 消失，而用户以为自己只是按了「撤销」。所以窗口内唯一的状态是「待提交」，`undoDelete` 撤的是
 * **提交**，不是数据。
 *
 * # 失败往哪里报
 *
 * | 通道 | 谁用 | 为什么 |
 * | --- | --- | --- |
 * | `throw` 给调用方 | `create` / `update` / `transition` | 调用点知道自己在干什么，能就地 toast；吞掉等于「动作失败了但界面像成功了」|
 * | `errors[projectId]` | `load` / 延迟提交的删除 | 没有调用方可以 catch —— 前者是读路径，后者在 5 秒后 |
 */
import { create } from 'zustand';

import { invokeErrorMessage } from '@/shared/utils/invokeError';

import {
  createWorkItem,
  deleteWorkItem,
  getStagePlan,
  listWorkItems,
  transitionWorkItem,
  updateWorkItem,
} from '../api/workItemsApi';
import type { CreateWorkItemParams, StagePlan, UpdateWorkItemParams, WorkItem } from '../types';

/** 撤销窗口：PRD US-CRUD-6 的「5 秒内可撤销」。 */
const UNDO_WINDOW_MS = 5000;

/** 在飞的列表请求（`projectId → promise`）：同项目重复 `load` 复用它，不发第二次 IPC。 */
const inFlight = new Map<string, Promise<void>>();

/** 待提交的删除（key = `${projectId}:${id}`）。撤销窗口的唯一真相，`reset()` 全部收掉。 */
const pendingDeletes = new Map<string, PendingDelete>();

/** 阶段轨的在飞请求。全局只有一份 plan，两个组件同时挂载不该打两次 IPC。 */
let planInFlight: Promise<void> | null = null;

/**
 * store 代数：`reset()` 递增，迟到的响应据此**丢弃**。
 *
 * `reset()` 的公开用途是「测试与项目切换」；项目切换之后仍然回来的旧列表写进新槽位，就是
 * 一个项目看见另一个项目的任务（`file/store.ts` 的 owner 守卫、`teamStore` 的 generation 同理）。
 */
let generation = 0;

interface PendingDelete {
  /** 被藏起来的原始项（撤销要放回来的是**它**，不是重新造一个）。 */
  item: WorkItem;
  /** 删除前在原列表里的下标：撤销放回**原位**，塞到末尾等于改了用户看到的顺序。 */
  index: number;
  timer: ReturnType<typeof setTimeout>;
}

export interface WorkItemsState {
  /** 按 projectId 分槽：`undefined` = 还没加载过（区别于「加载过但为空」的 `[]`）。 */
  itemsByProject: Record<string, WorkItem[] | undefined>;
  /** 阶段轨（全局同一份，后端 `StagePlan::default()`）。`null` = 还没拿到。 */
  plan: StagePlan | null;
  /** 正在加载的项目 id 集合（同一项目重复 load 不得发两次请求）。 */
  loading: Record<string, boolean>;
  /** 每个项目最近一次**读路径**错误（渲染用；下一次成功 load 清掉）。 */
  errors: Record<string, string | null>;

  /** 拉阶段轨（全局只拉一次：已有或已在飞就复用）。 */
  loadPlan: () => Promise<void>;
  /** 拉某个项目的列表；失败保留旧列表并写 `errors[projectId]`。 */
  load: (projectId: string) => Promise<void>;
  /** 建一条并**插到最前**（不等重拉）。 */
  create: (params: CreateWorkItemParams) => Promise<WorkItem>;
  /** 改一条：就地替换并置顶（`updatedAt` 由后端给）。 */
  update: (params: UpdateWorkItemParams) => Promise<WorkItem>;
  /** 乐观流转：先改本地，失败按快照回滚后抛出（提示方式交给 UI）。 */
  transition: (id: string, to: string, projectId: string) => Promise<void>;
  /** 乐观删除 + 撤销窗口：立刻从本地移除，`UNDO_WINDOW_MS` 后才真的提交删除。 */
  deleteWithUndo: (id: string, projectId: string) => Promise<void>;
  /** 撤销该项目最近一次删除；窗口外（没有待提交的删除）返回 `false`。 */
  undoDelete: (projectId: string) => boolean;
  /** 清空全部槽位 + 取消所有撤销窗口（测试与项目切换用）。 */
  reset: () => void;
}

/**
 * 列表顺序的唯一契约：`updatedAt DESC`（与后端 `ORDER BY updated_at DESC, id` 对齐）。
 * 所以「变了的东西要在最前面」不是审美，而是「本地顺序 = 下次 load 的顺序」。
 */
function upsertFront(list: WorkItem[], item: WorkItem): WorkItem[] {
  return [item, ...list.filter((row) => row.id !== item.id)];
}

/** 放回原索引（撤销与回滚共用）。`index` 越界时钳到末尾 —— 期间列表可能已经缩短。 */
function insertAt(list: WorkItem[], item: WorkItem, index: number): WorkItem[] {
  const rest = list.filter((row) => row.id !== item.id);
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

/**
 * 就地把某个项目的列表改写一遍，**只写已经加载过的槽位**。
 *
 * `update` / `transition` 的入参都是「已存在的一行」，能发起这两个动作就说明列表加载过；
 * 若槽位仍是 `undefined`，凭空造一个只有一条的列表会把「未加载」变成「已加载但不全」，
 * 那比不更新更糟（面板会以为这就是全部）。`create` 是唯一的例外，见它的实现。
 */
function patchProject(
  state: WorkItemsState,
  projectId: string,
  patch: (list: WorkItem[]) => WorkItem[],
): Partial<WorkItemsState> {
  const list = state.itemsByProject[projectId];
  if (list === undefined) return {};
  return { itemsByProject: { ...state.itemsByProject, [projectId]: patch(list) } };
}

/**
 * 失败原因 → 可读一句话。
 *
 * 主路径是 [`invokeErrorMessage`]（全仓唯一实现）。第二段只兜一种形状：后端若把 `AppError`
 * 序列化成 `{ message }` 对象，共享工具会把 `String(obj)` 判成 `[object Object]` 而退到 fallback，
 * 那时对象的 `message` 是唯一有用的信息。当前 `common/error.rs` 走 `serialize_str`（错误体就是
 * 字符串），所以这段今天不常触发 —— 但「错误位里出现 `[object Object]`」是一次性事故，值得三行。
 */
function readError(err: unknown, fallback: string): string {
  const text = invokeErrorMessage(err, '');
  if (text !== '') return text;
  const message = (err as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message.trim() !== '') return message.trim();
  return fallback;
}

/**
 * 撤销窗口到点后的**真正**提交。
 *
 * 失败时把那一行放回去并写 `errors[projectId]`：此时窗口已关，用户没有第二个入口能理解
 * 「刚删掉的东西怎么又在列表里」—— 行还在后端是事实，界面就该显示它，并给一句原因。
 */
function commitDelete(id: string, projectId: string, restore: PendingDelete): Promise<void> {
  const mine = generation;
  return deleteWorkItem(id).catch((err: unknown) => {
    if (mine !== generation) return;
    useWorkItemsStore.setState((state) => ({
      ...patchProject(state, projectId, (list) => insertAt(list, restore.item, restore.index)),
      errors: {
        ...state.errors,
        [projectId]: readError(err, 'Could not delete the work item'),
      },
    }));
  });
}

export const useWorkItemsStore = create<WorkItemsState>((set, get) => ({
  itemsByProject: {},
  plan: null,
  loading: {},
  errors: {},

  loadPlan: () => {
    // 全局同一份阶段轨：已有就不再问（后端是 `StagePlan::default()`，不存在「过期的 plan」）。
    if (get().plan !== null) return Promise.resolve();
    // 在飞复用：两个 `useStagePlan` 同时挂载只打一次 IPC。
    if (planInFlight !== null) return planInFlight;

    const mine = generation;
    const pending: Promise<void> = getStagePlan()
      .then((plan) => {
        if (mine !== generation) return;
        set({ plan });
      })
      .catch(() => {
        // 阶段轨是一次性常量，拉不到就保持 `null`：调用方据此不渲染轨道（而不是画一条假轨道）。
        // 不写 `errors` —— 那一格是按项目分的，这里没有项目可归；下一次挂载会重试。
      })
      .finally(() => {
        if (planInFlight === pending) planInFlight = null;
      });

    planInFlight = pending;
    return pending;
  },

  load: (projectId) => {
    // 同项目已在飞 ⇒ 返回**同一个** Promise：第二个调用方的 `await` 仍然有落地时刻，
    // 而 IPC 只发一次（连点刷新、两个面板同时挂载都走这里）。
    const existing = inFlight.get(projectId);
    if (existing !== undefined) return existing;

    const mine = generation;
    const pending = (async () => {
      set((state) => ({ loading: { ...state.loading, [projectId]: true } }));
      try {
        const items = await listWorkItems(projectId);
        if (mine !== generation) return;
        set((state) => ({
          // 空列表写入 `[]`（不是 `undefined`）：见文件头「两者语义不同」。
          itemsByProject: { ...state.itemsByProject, [projectId]: items },
          loading: { ...state.loading, [projectId]: false },
          errors: { ...state.errors, [projectId]: null },
        }));
      } catch (err: unknown) {
        if (mine !== generation) return;
        set((state) => ({
          // 失败**不动** `itemsByProject`：闪空比旧数据更糟，而错误位已经说明它可能过期。
          loading: { ...state.loading, [projectId]: false },
          errors: { ...state.errors, [projectId]: readError(err, 'Could not load the work items') },
        }));
      }
    })();

    inFlight.set(projectId, pending);
    void pending.finally(() => {
      if (inFlight.get(projectId) === pending) inFlight.delete(projectId);
    });
    return pending;
  },

  create: async (params) => {
    const item = await createWorkItem(params);
    set((state) => ({
      // 这里**不**套 `patchProject` 的存在性守卫：`create` 是唯一会引入一行「任何已加载快照
      // 里都还没有」的动作，而 US-CRUD-1 要求新卡片立刻出现在列顶部。槽位未加载时先落一行，
      // 下一次 `load` 会用后端的全量列表覆盖它。
      itemsByProject: {
        ...state.itemsByProject,
        [item.projectId]: upsertFront(state.itemsByProject[item.projectId] ?? [], item),
      },
    }));
    return item;
  },

  update: async (params) => {
    const item = await updateWorkItem(params);
    // 就地替换并置顶：改过的项在 `updatedAt DESC` 里本就该在第一行，重拉整表只为换个位置不值。
    set((state) => patchProject(state, item.projectId, (list) => upsertFront(list, item)));
    return item;
  },

  transition: async (id, to, projectId) => {
    const list = get().itemsByProject[projectId] ?? [];
    const index = list.findIndex((row) => row.id === id);
    const original = index >= 0 ? list[index] : undefined;

    if (original !== undefined) {
      // 乐观：先把 stage 改掉、`updatedAt` 提到「现在」—— 卡片立刻换列并置顶，
      // 不等一次 IPC 往返（拖拽/点 stage rail 的反馈延迟就是这么来的）。
      const optimistic: WorkItem = { ...original, stage: to, updatedAt: Date.now() };
      set((state) => patchProject(state, projectId, (current) => upsertFront(current, optimistic)));
    }

    try {
      const updated = await transitionWorkItem(id, to);
      // 后端是真相源：`stage` 用它的返回值、`updatedAt` 以它的时间戳为准（本地那个只是占位）。
      set((state) => patchProject(state, projectId, (current) => upsertFront(current, updated)));
    } catch (err: unknown) {
      // 回滚到**保存下来的原始项**（含原索引），不重拉列表：理由见文件头。
      if (original !== undefined) {
        set((state) =>
          patchProject(state, projectId, (current) => insertAt(current, original, index)),
        );
      }
      throw err;
    }
  },

  deleteWithUndo: async (id, projectId) => {
    const list = get().itemsByProject[projectId] ?? [];
    const index = list.findIndex((row) => row.id === id);
    if (index < 0) return; // 本地没有这一行：没有可撤销的东西，也就不提交删除（UI 只能删它渲染出来的行）

    const item = list[index];
    const key = `${projectId}:${id}`;

    // 连点删除：先收掉旧窗口，否则同一行会被提交两次删除（第二次必然 `NotFound`）。
    const stale = pendingDeletes.get(key);
    if (stale !== undefined) {
      clearTimeout(stale.timer);
      pendingDeletes.delete(key);
    }

    set((state) =>
      patchProject(state, projectId, (current) => current.filter((row) => row.id !== id)),
    );

    const entry: PendingDelete = {
      item,
      index,
      timer: setTimeout(() => {
        pendingDeletes.delete(key);
        // 到点才真删；失败由 `commitDelete` 归位并写错误位（这里没有调用方可以 catch）。
        void commitDelete(id, projectId, entry);
      }, UNDO_WINDOW_MS),
    };
    pendingDeletes.set(key, entry);
  },

  undoDelete: (projectId) => {
    // 契约只有 `projectId`：撤的是该项目**最近一次**删除。Map 保插入序，所以顺序遍历、留住
    // 最后一条同项目的即可（`reset()` 之后的空 Map 自然返回 `false`）。
    let target: [string, PendingDelete] | undefined;
    for (const entry of pendingDeletes) {
      if (entry[0].startsWith(`${projectId}:`)) target = entry;
    }
    if (target === undefined) return false;

    const [key, pending] = target;
    clearTimeout(pending.timer);
    pendingDeletes.delete(key);
    // 放回**原位**（不是末尾，也不是按 `updatedAt` 重排）：用户撤销的是「这次删除」，
    // 不是「重新创建一条刚更新的任务」。
    set((state) =>
      patchProject(state, projectId, (list) => insertAt(list, pending.item, pending.index)),
    );
    return true;
  },

  reset: () => {
    // 先作废在飞响应，再收定时器：迟到的列表/阶段轨不许写进新会话的槽位。
    generation += 1;
    for (const pending of pendingDeletes.values()) clearTimeout(pending.timer);
    pendingDeletes.clear();
    inFlight.clear();
    planInFlight = null;
    set({ itemsByProject: {}, plan: null, loading: {}, errors: {} });
  },
}));

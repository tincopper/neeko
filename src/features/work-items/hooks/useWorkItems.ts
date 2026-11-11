/**
 * Tasks 面板的列表读面 + 动作面（Local provider）。
 *
 * # 为什么订阅要拆成三个 selector
 *
 * `useWorkItemsStore()` 不带选择器等于订阅**整个** store：任何一个项目的列表变化都会让所有
 * 项目（所有面板实例）重渲染。这里按「本项目列表 / 本项目在加载 / 本项目错误」分开订阅，
 * 再加一个稳定的 `actions`，别的项目拉数据时本组件不动。
 *
 * # 为什么 `actions` 必须 `useMemo`
 *
 * 每次 render 造一个新对象会让所有吃 `actions` 的子组件（卡片、工具栏）`memo` 全部失效 ——
 * 拖拽与 hover 期间正好是最贵的时候。所以对象只在 `projectId` 变化时重建，内部一律
 * `getState()` 取最新动作（不把 action 绑进闭包，也就不需要把它写进依赖）。
 *
 * # 动作出错不吞
 *
 * `create` / `update` / `transition` / `remove` 的失败**原样抛给调用方**（组件 catch 后 toast）：
 * 只有调用点知道「这次失败该显示在哪」。store 的错误位留给读路径（`load` 与 5 秒后的延迟提交）。
 */
import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/shallow';

import { useWorkItemsStore } from '../store/workItemsStore';
import type { CreateWorkItemParams, UpdateWorkItemParams, WorkItem } from '../types';

/** 空列表的**稳定**引用：没有绑定项目时每次 render 都返回同一个数组，子组件 `memo` 才有意义。 */
const NO_ITEMS: WorkItem[] = [];

export interface WorkItemsActions {
  /** 建一条（`params.projectId` 自带归属，与 hook 绑定的项目不必一致）。 */
  create: (params: CreateWorkItemParams) => Promise<WorkItem>;
  update: (params: UpdateWorkItemParams) => Promise<WorkItem>;
  /** 流转到 `to`；失败已回滚并抛出。 */
  transition: (id: string, to: string) => Promise<void>;
  /** 乐观移除 + 撤销窗口；窗口到点才真删。 */
  remove: (id: string) => Promise<void>;
  /** 撤销该项目最近一次删除；窗口外返回 `false`。 */
  undo: () => boolean;
}

export interface UseWorkItemsResult {
  items: WorkItem[];
  loading: boolean;
  error: string | null;
  actions: WorkItemsActions;
}

/** 没有绑定项目时的失败原因：静默 no-op 会让调用方以为动作生效了。 */
function noProject(): Error {
  return new Error('useWorkItems has no project bound');
}

export function useWorkItems(projectId: string | null): UseWorkItemsResult {
  const items = useWorkItemsStore(
    useShallow((state) =>
      projectId === null ? NO_ITEMS : (state.itemsByProject[projectId] ?? NO_ITEMS),
    ),
  );
  const loading = useWorkItemsStore((state) => {
    if (projectId === null) return false;
    // 「还没加载过」也算加载中。`useEffect` 在首帧**之后**才发请求，只信 `loading[projectId]`
    // 会让第一帧同时满足「items 为空 + 不加载 + 没错误」—— 面板就会闪一下「还没有工作项」，
    // 而真相是「还没问到」（同 `useTeamList` 的三态分离）。
    // 失败过的空槽位不在此列：那一格有 `error`，否则错误态会永远转圈。
    return (
      state.loading[projectId] === true ||
      (state.itemsByProject[projectId] === undefined && state.errors[projectId] == null)
    );
  });
  const error = useWorkItemsStore((state) =>
    projectId === null ? null : (state.errors[projectId] ?? null),
  );
  const load = useWorkItemsStore((state) => state.load);

  useEffect(() => {
    // `null` 不发请求（面板还没绑定项目）；store 侧的 in-flight 去重让重复挂载不重复拉。
    if (projectId === null) return;
    void load(projectId);
  }, [projectId, load]);

  const actions = useMemo<WorkItemsActions>(
    () => ({
      create: (params) => useWorkItemsStore.getState().create(params),
      update: (params) => useWorkItemsStore.getState().update(params),
      transition: (id, to) =>
        projectId === null
          ? Promise.reject(noProject())
          : useWorkItemsStore.getState().transition(id, to, projectId),
      remove: (id) =>
        projectId === null
          ? Promise.reject(noProject())
          : useWorkItemsStore.getState().deleteWithUndo(id, projectId),
      undo: () => (projectId === null ? false : useWorkItemsStore.getState().undoDelete(projectId)),
    }),
    [projectId],
  );

  return { items, loading, error, actions };
}

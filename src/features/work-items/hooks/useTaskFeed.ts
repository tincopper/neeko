/**
 * Tasks 面板的**数据面**：本地工作项 + 已启用的外部 provider（本期只有 GitHub PR）混排。
 *
 * # 为什么混排在这里，而不是各自塞进各自组件
 *
 * 「同一个面板里两种来源的卡片按同一套列 / 筛选 / 搜索走」是这个域的**核心承诺**
 * （design §10 成功标准 1-2）。让两个组件各画一半，会让看板出现两个滚动区、两套列头、
 * 两种搜索语义 —— 而「新增 provider 不改列表组件」也就无从谈起。所以合并只发生在**一个**
 * 地方：本 hook 的 `items`。
 *
 * # 顺序：本地在前，provider 在后，**不跨 provider 重排**
 *
 * 本地列表的顺序契约是 `updatedAt DESC`（与后端 `ORDER BY updated_at DESC, id` 一致）；
 * PR 的顺序是 `gh` 给的（新→旧）。两套排序键混排成一个全局序列必然要编一条「谁更新」的
 * 规则，而我们手里没有可比的时间（`PRListItem` 没有 updatedAt）。所以：各自保持自己那一份
 * 顺序，段内不重排 —— 这与 `BoardView`「渲染期不排序」的纪律同源。
 *
 * # `loading` 是两边的并集
 *
 * 首帧本地还没加载完、或者 PR 正在拉，都属于「还没问到」，面板该显示同一句加载提示。
 * 反之 `error` **不合并**：本地读失败与 PR 读失败是两条独立通道（重试入口不同），
 * 合并成一句会让用户重试错东西。
 */

import { useCallback, useMemo } from 'react';

import { useWorkItemsStore } from '../store/workItemsStore';
import { toLocalTask, type TaskItem } from '../viewModel';

import { useGithubPrs, type UseGithubPrsResult } from './useGithubPrs';
import { useWorkItems, type WorkItemsActions } from './useWorkItems';

export interface TaskFeed {
  /** 本地 + 已启用的外部 provider（本地在前；各 provider 内部顺序不变）。 */
  items: TaskItem[];
  /** 任一来源还在首轮加载中（面板据此显示「正在读取…」而不是空态）。 */
  loading: boolean;
  /** **本地**读路径错误（`load` / 延迟提交的删除）；PR 的错误在 `github.error`。 */
  error: string | null;
  /** 本地工作项的动作面（外部 provider 本期只读，没有动作）。 */
  actions: WorkItemsActions;
  /** 手动刷新：本地 + 已启用的 provider 一起重拉（PR 侧绕过「已拉过就不拉」的去重）。 */
  refresh: () => void;
  /** GitHub PR provider 的开关 / 可用性 / 列表（面板要把勾选框与原因画出来）。 */
  github: UseGithubPrsResult;
}

/**
 * `repoLabel` 是 PR 的仓库展示标签（`PRListItem` 里没有 `owner/name`，见 `viewModel.ts`）。
 * 空串 = 不知道，详情里就只显示 `#128`。
 */
export function useTaskFeed(projectId: string | null, repoLabel = ''): TaskFeed {
  const { items: localItems, loading: localLoading, error, actions } = useWorkItems(projectId);
  const github = useGithubPrs(projectId, repoLabel);

  const items = useMemo(() => {
    const local = localItems.map(toLocalTask);
    // 空数组走同一条返回路径：provider 关掉时 `items` 的引用只随本地列表变化（卡片 memo 不空转）。
    if (github.items.length === 0) return local;
    return [...local, ...github.items];
  }, [localItems, github.items]);

  const loading = localLoading || (github.enabled && github.loading);

  const refreshGithub = github.refresh;
  const refresh = useCallback(() => {
    if (projectId === null) return;
    // 本地：走 store 的 `load`（同项目在飞会被复用，连点不会打两次 IPC）。
    void useWorkItemsStore.getState().load(projectId);
    // PR：自增 epoch 显式重拉（没启用时它自己会早退，不产生请求）。
    refreshGithub();
  }, [projectId, refreshGithub]);

  return useMemo(
    () => ({ items, loading, error, actions, refresh, github }),
    [items, loading, error, actions, refresh, github],
  );
}

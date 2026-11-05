/**
 * 一个工作项的执行记录（详情「执行」区的读面）。
 *
 * # 为什么它不在 store 里
 *
 * 执行记录是**按工作项**的载荷，生命周期与「这次打开的详情」绑死：换一条就该作废，关掉就该
 * 丢弃。放进 store（按 `workItemId` 分槽）等于多一份要手工维护的缓存，而 store 是**工作项域
 * 状态** —— 执行记录是只读旁路（design §4.6），不进 `workItemsStore`。
 *
 * 所以它是**挂载期**的状态，与 `useStagePlan` 同一档：`runs` 的生命周期就是「这次打开的详情」。
 *
 * # 拉取时机：打开详情一次 + 手动刷新 + 写入成功后一次，**不轮询**
 *
 * design §4.6 明确禁止自动轮询：快照只是缓存（真相源在执行域），而一个每 N 秒自己变的徽标会
 * 让「这是刚查的」变成一句没人能验证的承诺。陈旧度由 `utils/runFreshness` 的布尔标记表达。
 *
 * # 「加载中」是派生的
 *
 * `fetched === null || fetched.workItemId !== workItemId` ⇒ 还没拿到。不在 effect 里同步
 * `setState(true)`：那会在挂载时多走一轮渲染，而「还没拿到」本来就是状态缺失的意思。刷新时
 * 清空 `fetched` 即回到加载中（在回调里改，不在渲染期改）。
 */
import { useCallback, useEffect, useState } from 'react';

import { invokeErrorMessage } from '@/shared/utils/invokeError';

import { listWorkItemRuns } from '../api/workItemsApi';
import type { WorkItemRun } from '../types';

export interface UseWorkItemRunsResult {
  runs: WorkItemRun[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** 最近一次**落地**的读取结果（带 `workItemId` 守卫：换了一条工作项就不能拿旧结果充数）。 */
interface RunsFetch {
  workItemId: string;
  runs: WorkItemRun[];
  error: string | null;
}

export function useWorkItemRuns(workItemId: string): UseWorkItemRunsResult {
  const [fetched, setFetched] = useState<RunsFetch | null>(null);
  /** 手动刷新：自增即重跑 effect（与「依赖变了」共用同一条路径，不另写一份拉取函数）。 */
  const [token, setToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listWorkItemRuns(workItemId).then(
      (runs) => {
        if (cancelled) return;
        setFetched({ workItemId, runs, error: null });
      },
      (err: unknown) => {
        if (cancelled) return;
        // 失败清空记录：留着上一轮的记录会让「刷新失败」看起来像「刷新成功且没变」。
        setFetched({ workItemId, runs: [], error: invokeErrorMessage(err, 'Failed to load runs') });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workItemId, token]);

  const reload = useCallback(() => {
    setFetched(null);
    setToken((n) => n + 1);
  }, []);

  const usable = fetched !== null && fetched.workItemId === workItemId ? fetched : null;

  return {
    runs: usable === null ? [] : usable.runs,
    loading: usable === null,
    error: usable === null ? null : usable.error,
    reload,
  };
}

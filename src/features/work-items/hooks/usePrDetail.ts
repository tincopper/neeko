/**
 * 单个 PR 的详情（`view_pr`）—— **只在真的要用它的字段时才拉**。
 *
 * # 为什么列表页不许拉它
 *
 * `list_prs` 返回的 `PRListItem` 已经够画卡片；`viewPr` 每调一次就是一个独立的 `gh` 进程，
 * N 条 PR 就是 N 次外部调用（在 50 条上限下是几秒的面板冻结）。所以详情才拉，且只拉**一条**。
 *
 * # 目前只用 `url`，但接口按整个 `PRInfo` 给
 *
 * 详情里的「在浏览器打开」需要 `url`，而 `PRListItem` 里没有这个字段。既然这一拉已经付了钱，
 * 正文 / draft / mergeable 就顺手可得 —— 但不在这里挑字段：那是呈现层的取舍（`PrTaskSection`
 * 决定渲染什么），不是数据层的。数据层只负责「这条 PR 的详情拿到了没有」。
 *
 * # 与 `useWorkItemRuns` 同一生命周期
 *
 * 「这次打开的详情」的挂载期状态，不进 store：换一条 PR 就作废、关掉详情就丢弃。失败保留
 * `null`（而不是把错误当数据），调用方据此禁用「在浏览器打开」并把原因挂在按钮上。
 */

import { useCallback, useEffect, useState } from 'react';

import { viewPr } from '@/features/git/api/gitApi';
import { useActiveWorkspaceSession } from '@/shared/store/workspaceStore';
import type { PRInfo } from '@/shared/types/git';
import { invokeErrorMessage } from '@/shared/utils/invokeError';
import type { ProjectId } from '@/shared/utils/workspaceRef';

/** 一次**落地**的读取结果，带 `prNumber` 守卫：换了一条 PR 就不能拿旧结果充数。 */
interface PrDetailFetch {
  prNumber: number;
  info: PRInfo | null;
  error: string | null;
}

export interface UsePrDetailResult {
  /** `null` = 还没拿到 / 拿不到（原因见 `error`）。 */
  info: PRInfo | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function usePrDetail(projectId: string | null, prNumber: number | null): UsePrDetailResult {
  // `as ProjectId` 是收回品牌（同 `WorkItemRunsSection`）：面板边界把品牌放宽成了 string。
  const session = useActiveWorkspaceSession(projectId as ProjectId | null);
  const [fetched, setFetched] = useState<PrDetailFetch | null>(null);
  /** 手动刷新：自增即重跑 effect（共用同一条拉取路径，不另写一份）。 */
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (prNumber === null || session === null) return;
    let cancelled = false;
    viewPr(session, prNumber).then(
      (info) => {
        if (cancelled) return;
        setFetched({ prNumber, info, error: null });
      },
      (err: unknown) => {
        if (cancelled) return;
        setFetched({ prNumber, info: null, error: invokeErrorMessage(err, '读取 PR 详情失败') });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [prNumber, session, token]);

  const reload = useCallback(() => setToken((current) => current + 1), []);

  // 「加载中」是派生的：还没有属于这一条的结果就是加载中（不在 effect 里同步置位）。
  const mine =
    prNumber !== null && fetched !== null && fetched.prNumber === prNumber ? fetched : null;
  const loading = prNumber !== null && session !== null && mine === null;

  return { info: mine?.info ?? null, loading, error: mine?.error ?? null, reload };
}

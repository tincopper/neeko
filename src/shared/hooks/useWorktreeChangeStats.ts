import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/shallow';

import { selectEntries, useProjectStore } from '@/shared/store/projectStore';
import type { GitStatusSnapshot, Worktree } from '@/shared/types';
import { repoKeyOf, type RepoKey } from '@/shared/utils/repoRef';

/** worktree 行的 +A -D 聚合（本 hook 的返回值形状，不外泄）。 */
interface ChangeStat {
  add: number;
  del: number;
}

/**
 * 进程级单飞：同一单元在**并发**窗口内只发一次拉取。
 *
 * 本地侧栏与 WSL/SSH 侧栏可能同时挂载同一项目 —— 两份 `fetchedRef` 各自记账，若不去重就会
 * 对同一单元发 2× RPC。单飞只合并「并发」，promise 落定即释放：后续触发（清单变化 / 重挂）
 * 仍会重拉。键是仓库单元身份（含 projectId），不做跨项目错误共享。
 */
const inFlight = new Map<string, Promise<GitStatusSnapshot | null>>();

function fetchOnce(
  key: string,
  worktreePath: string,
  fetchStatus: (worktreePath: string) => Promise<GitStatusSnapshot | null>,
): Promise<GitStatusSnapshot | null> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = fetchStatus(worktreePath);
  inFlight.set(key, pending);
  // 无论成败，并发窗口结束即释放（失败由调用方按「未知」重试）。
  pending.then(
    () => inFlight.delete(key),
    () => inFlight.delete(key),
  );
  return pending;
}

/**
 * worktree 行的 chip 聚合数据（本地侧栏与 WSL/SSH 侧栏**共用同一张快照表**）。
 *
 * 两个不变量在这里收成一处实现，避免本地 / 远端两套形态漂移：
 *
 * 1. **按单元订阅**：只选择**本列表这些单元**的 entries（`useShallow` 按引用浅比较），store 里
 *    别的单元 / 别的项目变化不重渲本列表；缺失 = 未知 ⇒ 不出 chip。
 * 2. **挂载级新鲜度守卫**：已拉清单按**组件挂载**记账。槽位跨挂载持久，若拿 `key in statuses`
 *    当跳过守卫，未挂载单元（没有生产者）的 chip 一旦拉过就永久陈旧且抑制重拉（旧数据伪装成
 *    事实）；挂载级 ref 恢复「重新打开面板即重拉」。它同时防住
 *    `applyStatus` → statuses 变化 → effect 重跑 → 再拉取的自激环。
 *
 * 拉取失败 / 身份漂移（`repo_key` 不匹配）= 未知：退出已拉清单（允许重试），**绝不写 `0/0`**。
 *
 * **不做组件生命周期取消**：`applyStatus` 写的是全局 store（按 `repo_key` 定址、version 闸门），
 * 不是组件本地 state —— 组件卸载 / `React.StrictMode` 重挂之后应用它依然正确且有益。曾用
 * `cancelled` 丢弃首轮结果，而 StrictMode（`main.tsx` 已启用）的「重挂」会让次轮因 key 已在
 * 已拉清单而跳过 ⇒ 结果被两头丢掉、chip 永不出现（测试无 StrictMode 包裹，故曾静默通过）。
 *
 * @param fetchStatus 按需拉取某单元 status 的实现（本地走 `getRepoStatus`，远端走连接域命令面）；
 *   失败应返回 `null` 而非抛出。
 */
export function useWorktreeChangeStats(
  projectId: string,
  worktrees: Worktree[],
  fetchStatus?: (worktreePath: string) => Promise<GitStatusSnapshot | null>,
): Record<string, ChangeStat> {
  // 精确订阅：只关心本列表每个单元自己的 entries。槽位是不可变更新，entries 引用变化 =
  // 该单元真的变了；`useShallow` 让别的单元的快照推送不触发本列表重渲。
  const perUnitEntries = useProjectStore(
    useShallow((s) => worktrees.map((wt) => selectEntries(s, repoKeyOf(projectId, wt.path)))),
  );
  const fetchedRef = useRef<Set<RepoKey>>(new Set());

  useEffect(() => {
    if (!fetchStatus) return;
    // 先收敛「已拉清单」到当前列表：单元被移出列表后它的 key 必须退出 —— 否则同一挂载内
    // 「删掉再建同路径」不会重拉，清单也会无界增长。
    const present = new Set(worktrees.map((wt) => repoKeyOf(projectId, wt.path)));
    for (const key of fetchedRef.current) {
      if (!present.has(key)) fetchedRef.current.delete(key);
    }
    for (const wt of worktrees) {
      const key = repoKeyOf(projectId, wt.path);
      if (fetchedRef.current.has(key)) continue;
      fetchedRef.current.add(key);
      fetchOnce(key, wt.path, fetchStatus)
        .then((snapshot) => {
          if (!snapshot || snapshot.repo_key !== key) {
            // 失败 / 身份漂移 = 未知：退出已拉清单，下一次触发（清单变化 / 重挂载）可重试。
            fetchedRef.current.delete(key);
            return;
          }
          useProjectStore.getState().applyStatus(snapshot);
        })
        .catch(() => {
          fetchedRef.current.delete(key);
        });
    }
  }, [worktrees, projectId, fetchStatus]);

  return useMemo(() => {
    const next: Record<string, ChangeStat> = {};
    worktrees.forEach((wt, i) => {
      const entries = perUnitEntries[i];
      if (!entries) return;
      next[wt.path] = {
        add: entries.reduce((s, f) => s + f.additions, 0),
        del: entries.reduce((s, f) => s + f.deletions, 0),
      };
    });
    return next;
  }, [worktrees, perUnitEntries]);
}

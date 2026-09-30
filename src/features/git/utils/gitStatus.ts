import { useProjectStore } from '@/shared/store/projectStore';
import { parseRepoKey, repoKeyLabel, type RepoKey } from '@/shared/utils/repoRef';

import { getRepoStatus } from '../api/gitApi';

/**
 * 刷新一个仓库单元的 status —— changed_files 的**唯一**显式刷新入口。
 *
 * 第一性原理：status 是 per 工作树 的事实，因此刷新目标必须是一个 `RepoKey`，
 * 而不是「projectId + 碰巧从全局镜像里读到的 worktreePath」。旧签名的两处结构性缺陷：
 * - `worktreePath === ''` 表示主仓，而调用点常在事件回调里现取全局镜像 → 取错就是串数据；
 * - worktree / WSL 分支返回 `version: 0` → gate 只能恒放行 → pull 结果能覆盖任意时刻的
 *   push 快照（同一槽后到者胜）。
 * 现在两条都不存在：目标由入参显式给出，version 恒有意义（gate 在 store 内）。
 *
 * **失败语义**：命令报错 = 该单元状态未知，**不清空也不覆盖**已有槽位（由调用方决定是否
 * 提示），绝不写入「空列表」——空列表是一个断言，不是错误。
 */
export async function refreshRepoStatus(repoKey: RepoKey | string): Promise<void> {
  const { projectId, worktreePath } = parseRepoKey(String(repoKey));
  try {
    const snapshot = await getRepoStatus(projectId, worktreePath);
    useProjectStore.getState().applyStatus(snapshot);
  } catch (e) {
    console.error('[refreshRepoStatus] status refresh failed for', repoKeyLabel(repoKey), e);
  }
}

/**
 * 按单元去抖合并的刷新调度器：同一 `repoKey` 在静默窗口内多次调度只执行一次。
 *
 * 存在理由：`git-changed` / 窗口聚焦 / 文件操作成功等事件在构建期高频爆发，若每个事件
 * 都立即刷新会形成刷新风暴。窗口长度是**成本旋钮**，不再是正确性依赖 —— 权威推送按
 * repo_key 定址，任何一次调度错位都不会把别的数据写进槽里。
 */
export function createDebouncedStatusRefresh(debounceMs: number) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  return {
    schedule(repoKey: RepoKey | string, run: (repoKey: string) => void) {
      const key = String(repoKey);
      const existing = timers.get(key);
      if (existing !== undefined) clearTimeout(existing);
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          run(key);
        }, debounceMs),
      );
    },
    clear() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}

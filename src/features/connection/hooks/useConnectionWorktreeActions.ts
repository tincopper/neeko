import { useCallback, useMemo } from 'react';

import type { GitStatusSnapshot } from '@/shared/types';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import {
  getWorkspaceStatus,
  isWorktreeDirty,
  removeWorktree,
  renameWorktree,
} from '../../git/api/gitApi';

/**
 * SSH / WSL 卡片上 linked worktree 行的命令面（改名 / 删除 / 取变更 / 脏检查）。
 *
 * 抽出的理由与「UI 组件 300 行上限」同源：卡片只负责渲染与视图态，跨语言命令调用一律
 * 收拢到 feature hook（`src/AGENTS.md`：Tauri 数据交互统一走 hooks / state，不在 UI 渲染层
 * 裸 invoke）。此前这四条命令与卡片渲染混在同一个文件里，卡片因此越过 300 行红线。
 *
 * **与本地侧栏的差别**（不要照抄 `useWorktreeListActions` 的收口）：远端单元没有 push
 * 生产者、也没有本地终端缓存，因此这里不做「槽位作废 / 终端回收」，删除/改名后由调用方
 * 的 `onRefresh` 重拉列表收敛。
 */
export function useConnectionWorktreeActions(projectId: ProjectId, logTag: string) {
  const rename = useCallback(
    (oldPath: string, newName: string) => {
      const newFullPath = oldPath.replace(/[^/\\]+$/, newName);
      renameWorktree(projectId, oldPath, newFullPath).catch(console.error);
    },
    [projectId],
  );

  const remove = useCallback(
    (wtPath: string) => {
      removeWorktree(projectId, wtPath).catch((e: unknown) => {
        console.error(`${logTag} Failed to remove worktree:`, e);
      });
    },
    [projectId, logTag],
  );

  const fetchStatus = useCallback(
    (worktreePath: string): Promise<GitStatusSnapshot | null> =>
      // 失败 = 该单元状态未知（由调用方按「无 chip」渲染并允许重试），绝不返回空数组假装「干净」。
      getWorkspaceStatus(projectId, worktreePath).catch(() => null),
    [projectId],
  );

  const checkDirty = useCallback(
    (worktreePath: string): Promise<boolean> => {
      return isWorktreeDirty(projectId, worktreePath).catch(() => false);
    },
    [projectId],
  );

  // 稳定引用：消费方（ConnectionWorktreeList 的 effect 依赖）不应因每次渲染换新函数而重跑
  return useMemo(
    () => ({ rename, remove, fetchStatus, checkDirty }),
    [rename, remove, fetchStatus, checkDirty],
  );
}

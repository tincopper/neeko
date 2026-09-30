import { useEffect } from 'react';

import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useActiveWorktreePath } from '@/shared/store/worktreeStore';
import type { AheadBehind } from '@/shared/types';
import { repoKeyOf } from '@/shared/utils/repoRef';

interface AheadBehindCommands {
  getAheadBehind(): Promise<AheadBehind>;
}

/**
 * useAheadBehindSync —— 激活项目 / 激活单元变化时取一次 ahead/behind。
 *
 * **键 = 仓库单元身份**（`RepoKey`）：`commands` 绑定的是**当前激活单元**（`useActiveProject`），
 * 因此取回的当然是该单元的数字，就必须写在该单元的键下。旧实现在这里按
 * `{source}:{connectionId}:{projectId}` 拼键，与读侧的 `{source}:{connectionId}` 约定又不一致
 * （`distro` / `${host}:${port}` / `host` 三种），于是主仓徽标读的是「激活单元」的键或干脆读不到。
 *
 * 与 `useRefreshGitInfo` 的关系：两者是**同一事实的两个触发时机**（本项目切换 vs 手动刷新），
 * 键与语义完全一致，不存在第二个身份。
 */
export function useAheadBehindSync(commands?: AheadBehindCommands | null) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeWorktreePath = useActiveWorktreePath();
  const setAheadBehind = useGitStore((s) => s.setAheadBehind);

  useEffect(() => {
    if (!commands || !activeProjectId || !activeProject) return;

    // 非 git 项目（git_info 为 null）跳过 ahead/behind 查询
    if (activeProject.git_info === null) return;

    const repoKey = repoKeyOf(activeProjectId, activeWorktreePath);

    let cancelled = false;
    commands
      .getAheadBehind()
      .then((info) => {
        if (!cancelled) setAheadBehind(repoKey, info);
      })
      .catch(() => {
        if (!cancelled) setAheadBehind(repoKey, null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, activeProject, activeWorktreePath, commands, setAheadBehind]);
}

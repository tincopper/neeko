import { useEffect } from 'react';

import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useActiveCheckoutPath } from '@/shared/store/workspaceStore';
import type { AheadBehind } from '@/shared/types';
import { workspaceKeyOf } from '@/shared/utils/workspaceRef';

interface AheadBehindCommands {
  getAheadBehind(): Promise<AheadBehind>;
}

/**
 * useAheadBehindSync —— 激活项目 / 激活单元变化时取一次 ahead/behind。
 *
 * **键 = Workspace身份**（`WorkspaceKey`）：`commands` 绑定的是**当前激活单元**（`useActiveProject`），
 * 因此取回的当然是该单元的数字，就必须写在该单元的键下。旧实现在这里按
 * `{source}:{connectionId}:{projectId}` 拼键，与读侧的 `{source}:{connectionId}` 约定又不一致
 * （`distro` / `${host}:${port}` / `host` 三种），于是主仓徽标读的是「激活单元」的键或干脆读不到。
 *
 * 与 `useRefreshGitInfo` 的关系：两者是**同一事实的两个触发时机**（本项目切换 vs 手动刷新），
 * 键与语义完全一致，不存在第二个身份。
 *
 * **定位（本次改造后）**：权威生产者是Workspace的 `GitStatusSnapshot`（`git-status-snapshot`
 * 事件单通道投递 ahead/behind，见 `useGitStatusEventsSync`）。本 hook 只作**冷启动初始种子**
 * ——首个快照到达前让徽标不空；快照到达后由权威值接管。因此它保留一份冗余 pull，不参与
 * 任何版本门控（快照一到就会被覆盖）。
 */
export function useAheadBehindSync(commands?: AheadBehindCommands | null) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeCheckoutPath = useActiveCheckoutPath();
  const setAheadBehind = useGitStore((s) => s.setAheadBehind);

  useEffect(() => {
    if (!commands || !activeProjectId || !activeProject) return;

    // 非 git 项目（git_info 为 null）跳过 ahead/behind 查询
    if (activeProject.git_info === null) return;

    const workspaceKey = workspaceKeyOf(activeProjectId, activeCheckoutPath);

    let cancelled = false;
    commands
      .getAheadBehind()
      .then((info) => {
        if (!cancelled) setAheadBehind(workspaceKey, info);
      })
      .catch(() => {
        if (!cancelled) setAheadBehind(workspaceKey, null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, activeProject, activeCheckoutPath, commands, setAheadBehind]);
}

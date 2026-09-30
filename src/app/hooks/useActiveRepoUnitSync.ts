import { useEffect, useRef } from 'react';

import { useActivateRepoUnit } from '@/features/git/hooks/useActivateRepoUnit';
import { useProjectStore } from '@/shared/store/projectStore';
import { useActiveWorktreePath } from '@/shared/store/worktreeStore';
import { repoKeyOf } from '@/shared/utils/repoRef';

/**
 * 「当前视图是哪个仓库单元」→ 后端挂载 的唯一同步点（决策 D-B 的落地点）。
 *
 * 订阅 `(activeProjectId, 该项目激活的 worktree 路径)`，任一变化即请后端释放其它单元、
 * 挂载该单元并取回首个快照。用户动作只写激活态（见 `useWorktreeState.activateWorktree`），
 * 因此这里只有一个发起点 —— 不存在「谁先跑完决定列表对不对」的时序竞态。
 *
 * 非 git 项目（`git_info === null`）不发命令（`useActivateRepoUnit` 内亦有同一守卫，
 * 因为项目切换与 git_info 落地之间可能先到这里）。
 */
export function useActiveRepoUnitSync(): void {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeWorktreePath = useActiveWorktreePath();
  const isGitProject = useProjectStore((s) => {
    if (!s.activeProjectId) return false;
    const project = s.projects.find((p) => p.id === s.activeProjectId);
    // undefined（项目清单尚未加载）保守视为「先不动」；null = 明确非 git
    return project ? project.git_info !== null : false;
  });
  const activate = useActivateRepoUnit(activeProjectId);
  // 已发起过的单元 key：canonical 改写激活态（见 `useActivateRepoUnit`）会再触发一次本
  // effect，那是同一个单元的第二次表述，不该再打一次命令。
  const lastActivatedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!activeProjectId || !isGitProject) return;
    const key = String(repoKeyOf(activeProjectId, activeWorktreePath ?? null));
    if (lastActivatedKey.current === key) return;
    lastActivatedKey.current = key;
    void activate(activeWorktreePath ?? null).then((outcome) => {
      // 失败只放开「同一意图不再重发」的门闸；**不在这里判工作树死活**。
      // 「激活单元已从清单消失 ⇒ 回落主仓」的判据只有一处（`useAppShellData` 的校验，
      // 它比的是后端 canonical 清单）。两处判死会互相抖：实测冷启动时
      // `activate` 因首个快照还没落地而超时返回 Err，这里清一次、校验又恢复一次，
      // 挂载在 main ↔ worktree 之间来回翻（2026-09-28 隔离实例日志）。
      if (outcome === 'failed' && lastActivatedKey.current === key) {
        lastActivatedKey.current = null;
      }
    });
  }, [activeProjectId, activeWorktreePath, isGitProject, activate]);
}

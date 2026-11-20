import { useMemo } from 'react';

import { useSessionsByUnit } from '@/shared/hooks/useSessionsByUnit';
import { useActiveWorkspaceKey } from '@/shared/store/workspaceStore';
import type { Worktree } from '@/shared/types';
import { WorkspaceSession, type ProjectId } from '@/shared/utils/workspaceRef';

import { useTeamUnitKeys } from './useTeamsOfProject';

/**
 * 二级列表里应该显示的**工作树**：被团队占用的那些**在冗余时**不再重复列一条地点行。
 *
 * # 判据（与单元行的 `WorkspaceSession` 身份同一份铸造）
 *
 * `useTeamUnitKeys()` 给出「被某团队记着跑在里面」的单元 key（团队 `(projectId, workspaceWorktree)`
 * 两个后端字段相等）；本 hook 用每个工作树**自己的**单元 key 去命中。两边都经
 * `WorkspaceSession.of(...)` 铸造，所以「同一棵树两种写法」这种分叉不可表示，也不做路径前缀
 * 比较（红线 12）。
 *
 * # 为什么隐藏（用户裁决 2026-11-20）
 *
 * 「team 成员可以支持 worktree，但不用再单独显示为 worktree 的工作项」：团队行已经承担了
 * 「那棵树里在跑什么」的视角（展开即见成员）。再列一条同名的地点行，用户会以为它们是两个
 * 不同的东西。
 *
 * # 隐藏的前提：**这一行没有自己的内容**
 *
 * 「地点行」不只是另一个视角，它同时是那一棵树的全部能力入口（开终端 / 我的会话 / 删除 /
 * 重命名）。所以「被团队占用」本身不是隐藏的充分条件 —— 只要满足以下任一条，行必须留着：
 *
 * | 条件 | 否则会怎样 |
 * | --- | --- |
 * | 该单元有**用户自己的**会话（`sessionsByUnit` 已过滤掉成员会话）| 那几条会话从侧栏彻底消失 |
 * | 它就是**当前单元**（`useActiveWorkspaceKey`）| 第二级没有任何一行是「当前」，高亮凭空消失 |
 *
 * 两条都不是「团队行能不能替代」的问题：团队行永远只代表**成员**那一侧，而用户自己的东西
 * 与「我此刻站在哪」都不属于团队。判据因此是「隐藏 = 冗余」，不是「隐藏 = 被占用」。
 *
 * # 主仓（`local`）永不被过滤
 *
 * 主仓行不来自 `git worktree list`，不在本 hook 的输入里；`teams` 里 `workspaceWorktree: null`
 * 的团队铸出的 key 与 `WorkspaceSession.of(projectId, null)` 相等，而工作树列表里没有这一项
 * （linked worktree 的路径永远非空）—— 两个事实合起来保证主仓行始终在。
 */
export function useTeamFreeWorktrees(
  projectId: ProjectId,
  worktrees: readonly Worktree[],
): Worktree[] {
  const teamUnitKeys = useTeamUnitKeys();
  const byUnit = useSessionsByUnit();
  const activeUnitKey = useActiveWorkspaceKey(projectId);

  return useMemo(
    () =>
      worktrees.filter((wt) => {
        const unitKey = WorkspaceSession.of(projectId, wt.path).key;
        if (!teamUnitKeys.has(unitKey)) return true;
        // 被团队占用，但这一行仍有自己的内容 / 就是用户当前站的地方 ⇒ 不隐藏（见文件头表格）。
        if (unitKey === activeUnitKey) return true;
        return (byUnit.get(unitKey)?.length ?? 0) > 0;
      }),
    [worktrees, teamUnitKeys, byUnit, activeUnitKey, projectId],
  );
}

import { useMemo } from 'react';

import { useActiveWorkspaceRoot, useActiveWorkspaceSession } from '@/shared/store/workspaceStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';

/**
 * 建队要的**同一个激活单元**的两半。
 *
 * | 分量 | 回答 | 消费点 |
 * | --- | --- | --- |
 * | `root` | 进程在哪里跑（执行落点）| `start_team_session.projectPath` |
 * | `worktreePath` | 这个团队属于哪个 Workspace 单元（身份）| `start_team_session.workspaceWorktree` |
 *
 * `worktreePath === null` ⟺ 主 checkout（不是「未知」）。
 */
export interface TeamWorkspaceAddress {
  root: string | null;
  worktreePath: string | null;
}

/**
 * 团队地址：**一个激活单元，两半入参**。
 *
 * 两半必须同源（都经 `selectActiveCheckoutPath` 派生）：一个用激活单元、另一个用项目根会让
 * 团队的 `session_cursors.workspace_key` 落到另一棵树下 —— 而侧栏分组与「历史归属」正是
 * 按它精确相等。这里只是两个既有派生点（`useActiveWorkspaceRoot` /
 * `useActiveWorkspaceSession`）的组合，**不新造路径**（红线 12：不从 `project.path` 手拼）。
 *
 * 返回对象做了记忆化：两个分量都是字符串，值不变时对象身份不该变（回调依赖不必每渲染重建）。
 */
export function useTeamWorkspaceAddress(
  projectId: ProjectId | null | undefined,
  projectPath: string | null | undefined,
): TeamWorkspaceAddress {
  const root = useActiveWorkspaceRoot(projectId, projectPath);
  const worktreePath = useActiveWorkspaceSession(projectId ?? null)?.worktreePath ?? null;
  return useMemo(() => ({ root, worktreePath }), [root, worktreePath]);
}

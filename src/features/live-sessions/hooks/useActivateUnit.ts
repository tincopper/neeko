import { useCallback } from 'react';

import { useProjectActionsContext } from '@/shared/contexts/ProjectActionsContext';
import type { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { activateUnit } from '../utils/activateUnit';

/**
 * 侧栏行点击的「切项目 + 切单元」能力，绑成 `(unit) => Promise<void>`。
 *
 * 本文件只做 React 绑定（取 context 里的唯一序列 → 注入纯编排），与
 * `useSessionRowActions` 同一条纪律：判据、顺序都在 `utils/activateUnit`（无 React，可直测），
 * hook 不成为第二个实现处。
 *
 * 无 `ProjectActionsProvider` 时 `useProjectActionsContext()` **抛错**（不静默降级）：
 * 静默不切项目正是本函数要修的缺陷形态。
 *
 * 返回 Promise 而不是 `void`：调用侧要把「激活 tab / 开面板」接在单元落回**之后**
 * （`openBoardTab` 按当前激活单元落键，先开就会登记到主仓）。
 */
export function useActivateUnit(): (unit: WorkspaceSession) => Promise<void> {
  const { onSelectProject } = useProjectActionsContext();

  return useCallback(
    (unit: WorkspaceSession) =>
      activateUnit({ selectProject: onSelectProject }, unit.projectId, unit.worktreePath),
    [onSelectProject],
  );
}

import React, { useCallback } from 'react';

import { TeamPanel } from '@/features/agent-team';
import { useTerminalTabs } from '@/features/terminal';
import { useAppContext } from '@/shared/contexts';
import { useProjectStore } from '@/shared/store/projectStore';
import type { TeamSession } from '@/shared/types/team';
import type { ProjectId } from '@/shared/utils/workspaceRef';

/**
 * Team dock 面板适配层：把两个**跨域**的东西接上。
 *
 * 1. **toast**：`AppContext` 的 `showToast`（团队域不持有通知 store）。
 * 2. **成员 PTY 的接管**：团队后端已经起好了队长与成员的进程，前端只需要把它们渲染出来。
 *    走 [`useTerminalTabs().openExistingTerminalTab`] —— 它带 `existingSessionId`，local
 *    策略据此**不再**发 `create_terminal_session`，并且关闭 tab 不会杀掉进程（团队仍持有该
 *    会话）。同一 session 已开过 tab 时它会激活那一个，而不是开第二个（两个 tab 抢同一个
 *    drain，输出会两边都缺）。
 *
 * 两个入口（队长自动开 / 花名册上按「打开终端」）**共用**同一个底层动作，但语义不合并：
 * 队长那条在建队成功后自动触发（拿 `TeamSession`），成员那条是用户看着花名册按的
 * （拿花名册里已有的 `terminalId`）。
 *
 * 面板本身（`TeamPanel`）不认识终端域，也不认识 AppContext —— 这两个连接点只在这里。
 *
 * # 成员终端用**团队自己的** projectId
 *
 * 终端 tab 按 `(projectId, 工作区)` 落键（`openExistingTerminalTab(projectId, …)`），而
 * 团队的项目是**团队行上的事实**（`team.projectId`）：它可以和「当前激活项目」不是同一个
 * —— 用户切开另一个项目、或切到另一个工作树之后，团队仍然归它建队时那个项目。用激活项目
 * 顶替的症状很隐蔽：进程接得上、输出也有，只是 tab 登记在另一棵树下面（关/恢复/分屏时
 * 才会显形）。所以这里只用面板传进来的那个 id。
 *
 * `null` 只有两种来源：快照还没落地，或 v16 之前建的行（`project_id` 为空）。后者只能沿
 * 旧路径猜（激活项目）—— 那是历史行的兜底，不是新行为的判据。
 */
const TeamPanelWrapper: React.FC = React.memo(() => {
  const { showToast } = useAppContext();
  const projectId = useProjectStore((s) => s.activeProjectId);
  const { openExistingTerminalTab } = useTerminalTabs();

  const handleOpenLeaderTerminal = useCallback(
    (session: TeamSession, title: string) => {
      if (!projectId || !session.terminalId) return;
      openExistingTerminalTab(projectId, session.terminalId, title);
    },
    [projectId, openExistingTerminalTab],
  );

  /**
   * 花名册行的「打开终端」。
   *
   * 这里**不再**判 `terminalId` 是否为空：花名册已经保证「没有进程」的行不会调到这里
   * （按钮置灰 + 判据在 `utils/memberTerminal`）。再判一次就是第二个判据点，
   * 而两处一旦漂移，症状是「按钮能点但什么都不发生」。
   */
  const handleOpenTerminal = useCallback(
    (terminalId: string, title: string, teamProjectId: ProjectId | null) => {
      // 团队的 id 优先；`null`（快照未到 / v16 之前建的行）才回落到激活项目。
      const target = teamProjectId ?? projectId;
      if (!target) return;
      openExistingTerminalTab(target, terminalId, title);
    },
    [projectId, openExistingTerminalTab],
  );

  return (
    <TeamPanel
      onShowToast={showToast}
      onOpenLeaderTerminal={handleOpenLeaderTerminal}
      onOpenTerminal={handleOpenTerminal}
    />
  );
});
TeamPanelWrapper.displayName = 'TeamPanelWrapper';

export default TeamPanelWrapper;
export { TeamPanelWrapper };

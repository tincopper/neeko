import React, { useCallback } from 'react';

import { TeamPanel } from '@/features/agent-team';
import { useTerminalTabs } from '@/features/terminal';
import { useAppContext } from '@/shared/contexts';
import { useProjectStore } from '@/shared/store/projectStore';
import type { TeamSession } from '@/shared/types/team';

/**
 * Team dock 面板适配层：把两个**跨域**的东西接上。
 *
 * 1. **toast**：`AppContext` 的 `showToast`（团队域不持有通知 store）。
 * 2. **队长 PTY 的接管**：`start_team_session` 已经在后端起好了队长进程，前端只需要
 *    把它渲染出来。走 [`useTerminalTabs().openExistingTerminalTab`] —— 它带
 *    `existingSessionId`，local 策略据此**不再**发 `create_terminal_session`，
 *    并且关闭 tab 不会杀掉进程（团队仍持有该会话）。同一 session 已开过 tab 时它会激活
 *    那一个，而不是开第二个（两个 tab 抢同一个 drain，输出会两边都缺）。
 *
 * 面板本身（`TeamPanel`）不认识终端域，也不认识 AppContext —— 这两个连接点只在这里。
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

  return <TeamPanel onShowToast={showToast} onOpenLeaderTerminal={handleOpenLeaderTerminal} />;
});
TeamPanelWrapper.displayName = 'TeamPanelWrapper';

export default TeamPanelWrapper;
export { TeamPanelWrapper };

import React, { useCallback } from 'react';

import { TeamPanel, useTeamBoardTab, useTeamTaskTab } from '@/features/agent-team';
import { conversationIdOf, conversationTabTitle } from '@/features/conversation';
import { useTerminalTabs } from '@/features/terminal';
import { useAppContext } from '@/shared/contexts';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import type { Tab } from '@/shared/types/tab';
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
    (session: TeamSession, title: string, agentId: string | undefined) => {
      if (!projectId || !session.terminalId) return;
      // agentId 由面板从快照解析后传入 —— tab 栏据此显示品牌图标。
      openExistingTerminalTab(projectId, session.terminalId, title, agentId);
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
    (
      terminalId: string,
      title: string,
      agentId: string | undefined,
      teamProjectId: ProjectId | null,
    ) => {
      // 团队的 id 优先；`null`（快照未到 / v16 之前建的行）才回落到激活项目。
      const target = teamProjectId ?? projectId;
      if (!target) return;
      openExistingTerminalTab(target, terminalId, title, agentId);
    },
    [projectId, openExistingTerminalTab],
  );

  /** 看板 / 分配图 → 中央 tab（projectId 回落与终端同一口径）。 */
  const { openBoardTab } = useTeamBoardTab();
  const handleOpenBoard = useCallback(
    (teamId: string, teamName: string, teamProjectId: ProjectId | null, view: 'board' | 'flow') => {
      const target = teamProjectId ?? projectId;
      if (!target) return;
      openBoardTab({ teamId, teamName, projectId: target, view });
    },
    [projectId, openBoardTab],
  );

  /**
   * 已退出成员的**历史会话** → `conversation` tab。
   *
   * 与「打开会话」（接管活 PTY）是两条路：`archive_member` 归档时清掉了 terminalId，
   * 但 CLI 的会话文件仍在磁盘上 —— 用观察者记下的 `agentSessionId` 拼出
   * `conversation` 域的 `agentId:nativeId` 即可打开（后端对冷缓存也会按需重扫，见
   * `manager::session_file_path`）。
   *
   * 复合键走 [`conversationIdOf`]（唯一铸造点）—— 格式的权威在 Rust
   * `parse_conversation_id`，裸模板串会让格式变更时静默失联。
   *
   * `teamProjectId` 优先（与终端 / 看板 / 任务同一口径）：历史会话 tab 也按
   * `(projectId, 工作区)` 落键，用激活项目顶替会把 tab 登记到另一棵树。
   */
  const handleOpenMemberHistory = useCallback(
    (agentId: string, agentSessionId: string, title: string, teamProjectId: ProjectId | null) => {
      const target = teamProjectId ?? projectId;
      if (!target) return;
      const session = activeWorkspaceSession(target);
      const tabId = `tab_${crypto.randomUUID()}`;
      const tab: Tab = {
        id: tabId,
        scope: { kind: 'workspace', session },
        // 主线的 `conversationTabTitle` 只做 `userTitle → title` 两级兜底（红线 17：
        // 不再用 agentId 编第三份标签），wire 上的 title 已保证非空。
        title: conversationTabTitle({ title }),
        data: {
          kind: 'conversation',
          conversationId: conversationIdOf(agentId, agentSessionId),
          agentId,
        },
      };
      useEditorStore.getState().addTab(tab);
      useEditorStore.getState().activateTab(session.key, tabId);
    },
    [projectId],
  );

  /** 任务详情 → 中央 tab（markdown + 步骤轨迹；projectId 落键同上）。 */
  const { openTaskTab } = useTeamTaskTab();
  const handleOpenTaskTab = useCallback(
    (teamId: string, taskId: string, title: string, teamProjectId: ProjectId | null) => {
      const target = teamProjectId ?? projectId;
      if (!target) return;
      openTaskTab({ teamId, taskId, title, projectId: target });
    },
    [projectId, openTaskTab],
  );

  return (
    <TeamPanel
      onShowToast={showToast}
      onOpenLeaderTerminal={handleOpenLeaderTerminal}
      onOpenTerminal={handleOpenTerminal}
      onOpenBoard={handleOpenBoard}
      onOpenTaskTab={handleOpenTaskTab}
      onOpenHistory={handleOpenMemberHistory}
    />
  );
});
TeamPanelWrapper.displayName = 'TeamPanelWrapper';

export default TeamPanelWrapper;
export { TeamPanelWrapper };

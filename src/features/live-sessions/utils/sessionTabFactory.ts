import { openAgentChatTab } from '@/features/agent-chat/api/openChatTab';
import { createTerminalTabIn } from '@/features/terminal/api/taskTerminal';
import { isLiveSession } from '@/shared/selectors/liveSessionSelectors';
import { resolveAgent } from '@/shared/store/agentStore';
import type { SessionView } from '@/shared/types/liveSessions';
import { buildResumeTaskCommand } from '@/shared/utils/agentCommand';
import type { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { liveSessionResumeCommand } from '../api/liveSessionsApi';

/**
 * 「按会话重建一条 tab」的执行侧（无 React）。
 *
 * 与判据分家：`sessionActivationPlan` 回答**该做什么**（纯函数，可直测），这里回答
 * **怎么做**。两条路都要创建 tab，于是共用 terminal 域的创建端口（配额 / id / 占位标题 /
 * 创建即激活）—— 本文件不手造 `Tab`，也不留第二份 `10`。
 *
 * 地址分量由调用方给的 `WorkspaceSession` 携带（红线 12：不在这里拆键串）。
 *
 * 两种 kind 的 tab 造法分别归各自域的端口（terminal 域 / agent-chat 域），
 * 本文件只做「哪种会话走哪条路」的分派。
 */
export async function recreateSessionTab(
  session: SessionView,
  workspace: WorkspaceSession,
): Promise<void> {
  if (session.kind === 'chat') {
    // chat 会话没有「接回进程」这回事：永远是一条新的空会话 tab（历史归 Histor）。
    openAgentChatTab(workspace, { agentId: session.agentId ?? undefined });
    return;
  }

  // 进程还活着（关 tab 时选了「后台运行」）⇒ **接回同一个 PTY**，不是重开。
  // `TerminalViewBase` 见到 tab 上已有 attachSessionId 就跳过 createSession。
  if (isLiveSession(session)) {
    // 配额满时端口返回 false —— 这里没有可展示的失败面，与既有入口保持一致（静默）。
    createTerminalTabIn(workspace, {
      agentId: session.agentId,
      attachSessionId: session.sessionId,
    });
    return;
  }

  // 已结束 ⇒ 起新进程，并让新会话继承旧身份（`adopt_live_session`）。
  // 标题刻意用**中性占位**：把旧会话的名字贴上去会让人以为对话已经接上了；
  // 真标题由 `resolveTabTitle` 在渲染期覆盖（与所有 tab 同一条路径）。
  createTerminalTabIn(workspace, {
    agentId: session.agentId,
    resumeFromSessionId: session.sessionId,
    ...(await resumeLaunch(session)),
  });
}

/**
 * 续写命令：`<agent.command> <agent.args…> <resume args…>`；拿不到就是空对象。
 *
 * `taskCommand` 一旦设置，`TerminalViewBase` 会**跳过**自动拉起 agent 直接执行它
 * （见那里的 `if (tabAgentId && !taskCommand)`）—— 所以这里必须给出完整命令行，
 * 而不是只给 `--resume <id>`。拼装与引号走 `shared/utils/agentCommand` 的唯一实现
 * （Histor 面板的恢复路径用同一个函数）。
 *
 * 拿不到的三种情况都退回「新建一个同 agent 的终端」，不猜：
 * 会话没有 agent（纯 shell）、没有 hook 上报过原生 id、adapter 不支持原生恢复。
 */
async function resumeLaunch(session: SessionView): Promise<{ taskCommand?: string }> {
  if (!session.agentId) return {};
  const resumeArgs = await liveSessionResumeCommand(session.sessionId).catch(() => null);
  if (!resumeArgs || resumeArgs.length === 0) return {};
  const agent = await resolveAgent(session.agentId);
  if (!agent?.command) return {};
  return { taskCommand: buildResumeTaskCommand(agent, resumeArgs) };
}

import { useCallback, useState } from 'react';

import type { TeamConfig, TeamSession } from '@/shared/types/team';
import { invokeErrorMessage } from '@/shared/utils/invokeError';
import { leaderTerminalTabTitle } from '@/shared/utils/teamTabTitles';

import { startTeamSession } from '../api/teamApi';
import { useTeamStore } from '../store/teamStore';

/**
 * 队长入口的**执行**部分：`start_team_session` → `openTeam` → 接管那个 PTY。
 *
 * # 顺序即契约
 *
 * 1. `start_team_session`（后端建队 + 起队长 PTY）。失败原样抛出 —— 准入拒绝的理由
 *    由后端给（「这个 CLI 起不来」「连不上工具面」），前端**不预判、不改写**：
 *    自己发明一份准入表就会与后端那份额外漂移（红线 14 同族）。
 * 2. `openTeam`（设 id + 拉快照）。先拉快照再开终端，是为了让「队长 · <队名>」这个标题
 *    用**后端给的名字**（`Team.name`），而不是前端从目录名另猜一个。
 * 3. 接管 PTY：`onOpenLeaderTerminal` 是跨域动作（终端域），由 app 层 wrapper 注入 ——
 *    团队域不 import 终端域（`src/AGENTS.md` 的导入防火墙）。
 *
 * `terminalId` 为 `null` 时**不假装成功**：团队仍开着，但告诉用户队长进程没落地。
 */

export interface StartTeamOptions {
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  /** 把队长 PTY 接进 dock 终端（跨域动作，由 app 层实现）。 */
  onOpenLeaderTerminal?: (
    session: TeamSession,
    title: string,
    /** 队长的 agent（tab 栏品牌图标用；快照在 openTeam 之后可查）。 */
    agentId: string | undefined,
  ) => void;
}

export interface StartTeamState {
  busy: boolean;
  /** 后端拒绝原因原文（`AppError` 的可读字符串）；`null` = 没有错误。 */
  error: string | null;
  /**
   * 建队并接管队长终端。
   *
   * 入参是一个**具名对象**（而不是六个位置参数）：建队要落的事实有五个，其中
   * `projectPath` 与 `workspaceWorktree` 必须来自**同一个激活单元**（根是执行落点、
   * worktree 是身份），把两个 `string | null` 相邻摆放的签名允许传反而不报错。载荷形状
   * 与 `StartTeamSessionParams` 同构，但两者不合并 —— 一个是 UI 意图，一个是 IPC 契约。
   */
  start: (params: StartTeamParams) => Promise<boolean>;
}

/** 建队所需的事实（`useStartTeam.start` 的唯一入参）。 */
export interface StartTeamParams {
  /**
   * 团队的**环境归属**（`activeProjectId`）。
   *
   * 它与 `projectPath` 不能互相顶替：路径可能是落在项目目录之外的工作树。
   */
  projectId: string;
  /** 队长用哪个 CLI（准入判据在后端）。 */
  agentId: string;
  /** 团队根（执行落点）。 */
  projectPath: string;
  /**
   * 同一个工作区的**身份**维度（`projectId` + 它 = 工作区身份）；`null` = 主 checkout。
   *
   * 必须与 `projectPath` 来自同一个激活单元，否则团队的 `session_cursors`
   * 会落到另一棵树下。
   */
  workspaceWorktree: string | null;
  /**
   * 团队的**显示名**（`null` = 没填 ⇒ 后端取工作区目录名）。
   *
   * 它是独立入参而不是 `config` 的一个键：名字不归 `TeamDefaults` 管，也没有默认值可比对。
   */
  name: string | null;
  /**
   * 只带**真的改过**的字段（`null` / 省略 = 全默认）：载荷里的每一项都是对后端缺省值的
   * 覆盖，原样回传一份完整配置会把它抄成前端常量。
   */
  config?: TeamConfig | null;
}

export function useStartTeam(options: StartTeamOptions = {}): StartTeamState {
  const { onShowToast, onOpenLeaderTerminal } = options;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(
    async (params: StartTeamParams): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const session = await startTeamSession(params);
        await useTeamStore.getState().openTeam(session.teamId);
        const teamName = useTeamStore.getState().snapshot?.team.name ?? session.teamId;

        if (session.terminalId) {
          // 队长的 agent 随建队响应回来（`leadAgentId`）—— 不从快照里找：
          // 那会让 tab 图标依赖「快照先落地」这个时序，第一帧是通用终端图标。
          onOpenLeaderTerminal?.(session, leaderTerminalTabTitle(teamName), session.leadAgentId);
          onShowToast?.(`Team "${teamName}" created; the lead session is open`, 'info');
        } else {
          onShowToast?.(
            `Team "${teamName}" created, but the lead process did not come up (no terminal to take over)`,
            'error',
          );
        }
        return true;
      } catch (err) {
        // 后端错误原文（含拒绝原因）—— 面板照原样显示，不加工。
        const message = invokeErrorMessage(err, 'Could not start the team session');
        setError(message);
        onShowToast?.(message, 'error');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onShowToast, onOpenLeaderTerminal],
  );

  return { busy, error, start };
}

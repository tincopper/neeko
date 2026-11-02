import { useCallback, useState } from 'react';

import type { TeamConfig, TeamSession } from '@/shared/types/team';
import { invokeErrorMessage } from '@/shared/utils/invokeError';

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
  onOpenLeaderTerminal?: (session: TeamSession, title: string) => void;
}

export interface StartTeamState {
  busy: boolean;
  /** 后端拒绝原因原文（`AppError` 的可读字符串）；`null` = 没有错误。 */
  error: string | null;
  /**
   * 建队并接管队长终端。
   *
   * `projectId` 是团队的**环境归属**（`activeProjectId`），`projectPath` 是工作区根 ——
   * 两者不能互相顶替：路径可能是落在项目目录之外的工作树。
   *
   * `config` 只该带**真的改过**的字段（`null` / 省略 = 全默认）：载荷里的每一项都是
   * 对后端缺省值的覆盖，原样回传一份完整配置会把它抄成前端常量。
   */
  start: (
    projectId: string,
    agentId: string,
    projectPath: string,
    config?: TeamConfig | null,
  ) => Promise<boolean>;
}

/** 队长 PTY 的 tab 标题（唯一构造点：快照里的队名）。 */
export function leaderTerminalTitle(teamName: string): string {
  return `队长 · ${teamName}`;
}

export function useStartTeam(options: StartTeamOptions = {}): StartTeamState {
  const { onShowToast, onOpenLeaderTerminal } = options;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(
    async (
      projectId: string,
      agentId: string,
      projectPath: string,
      config?: TeamConfig | null,
    ): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const session = await startTeamSession({ projectId, agentId, projectPath, config });
        await useTeamStore.getState().openTeam(session.teamId);
        const teamName = useTeamStore.getState().snapshot?.team.name ?? session.teamId;

        if (session.terminalId) {
          onOpenLeaderTerminal?.(session, leaderTerminalTitle(teamName));
          onShowToast?.(`团队「${teamName}」已建立，队长会话已打开`, 'info');
        } else {
          onShowToast?.(
            `团队「${teamName}」已建立，但队长进程没有落地（没有可接管的终端）`,
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

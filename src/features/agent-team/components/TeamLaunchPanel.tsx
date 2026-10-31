import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { useAgentStore } from '@/shared/store/agentStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useActiveWorkspaceRoot } from '@/shared/store/workspaceStore';
import type { TeamSession } from '@/shared/types/team';

import { useStartTeam } from '../hooks/useStartTeam';

/**
 * 队长入口（面板空态）：选 agent → 以队长身份开会话。
 *
 * # 三条「不要自己发明」的边界
 *
 * 1. **准入**：候选只按「`enabled` 且有 `command`」筛（能起一个进程的最低条件）。
 *    真正的准入（hooks / MCP / 传输 / 审批旁路四列）由后端 `plan_team` 在**写库之前**判，
 *    拒绝理由是 `AppError` 的可读原文，这里原样显示。前端再写一份准入表就会与实测矩阵
 *    漂移（红线 15 同族的坑：按 CLI 名分支）。
 * 2. **团队根**：走既有单一派生 [`useActiveWorkspaceRoot`]（≡ `workspaceRootOf` 作用在
 *    激活单元 key 上）。自己 `project.path` 当根会让 worktree 视图下团队开在主仓，
 *    而成员 cwd 与用户在看的树不是同一棵。
 * 3. **起进程之后的动作**：终端接管由 app 层注入（`onOpenLeaderTerminal`），团队域
 *    不认识终端域。
 */

interface TeamLaunchPanelProps {
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  onOpenLeaderTerminal?: (session: TeamSession, title: string) => void;
}

const TeamLaunchPanel: React.FC<TeamLaunchPanelProps> = React.memo(
  ({ onShowToast, onOpenLeaderTerminal }) => {
    const agents = useAgentStore((s) => s.agents);
    const activeProjectId = useProjectStore((s) => s.activeProjectId);
    const projectPath = useProjectStore((s) => s.activeProject?.path);
    // 团队根 = 激活单元的工作树根（唯一派生点，禁止手拼）。
    const workspaceRoot = useActiveWorkspaceRoot(activeProjectId, projectPath);

    const candidates = useMemo(
      () => (agents ?? []).filter((agent) => agent.enabled && agent.command.trim() !== ''),
      [agents],
    );

    const [agentId, setAgentId] = useState<string | null>(null);
    // 候选变化时收敛选择：已选且仍在候选里就保持，否则落到第一个（或 null）。
    useEffect(() => {
      if (agentId !== null && candidates.some((agent) => agent.id === agentId)) return;
      setAgentId(candidates[0]?.id ?? null);
    }, [candidates, agentId]);

    const { busy, error, start } = useStartTeam({ onShowToast, onOpenLeaderTerminal });

    const handleStart = useCallback(() => {
      if (!agentId || !workspaceRoot || busy) return;
      void start(agentId, workspaceRoot);
    }, [agentId, workspaceRoot, busy, start]);

    const canStart = agentId !== null && workspaceRoot !== null && !busy;

    return (
      <section aria-label="队长入口" className="flex flex-col gap-3 overflow-auto p-3">
        <header className="flex flex-col gap-0.5">
          <h2 className="text-ui font-semibold text-text-primary">Agent Team</h2>
          <p className="text-meta text-text-secondary">
            还没有打开的团队。以队长身份开一个会话，队长就能建成员、派活并盯着共享任务板。
          </p>
        </header>

        <div className="flex flex-col gap-1">
          <h3 className="text-meta font-semibold text-text-secondary">队长用哪个 CLI</h3>
          {candidates.length === 0 ? (
            <p className="text-meta text-text-muted">
              没有可用的 CLI agent（需要在设置里启用一个带命令的 agent）。
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {candidates.map((agent) => {
                const selected = agent.id === agentId;
                return (
                  <li key={agent.id}>
                    <button
                      type="button"
                      onClick={() => setAgentId(agent.id)}
                      aria-pressed={selected}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left',
                        'focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
                        selected
                          ? 'border-accent-blue bg-bg-selected'
                          : 'border-border bg-bg-secondary hover:bg-bg-hover',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-meta text-text-primary">
                        {agent.name}
                      </span>
                      <span className="shrink-0 font-mono text-micro text-text-muted">
                        {agent.command}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <h3 className="text-meta font-semibold text-text-secondary">团队根</h3>
          <p className="break-all font-mono text-micro text-text-muted">
            {workspaceRoot ?? '没有活动项目（先选择一个项目）'}
          </p>
        </div>

        {error ? (
          // 后端拒绝原因原文：准入失败的理由只有后端知道，改写会把唯一有用的信息丢掉。
          <p role="alert" className="whitespace-pre-wrap text-meta text-accent-red">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={handleStart}
          disabled={!canStart}
          className={cn(
            'rounded-md px-3 py-1.5 text-meta font-medium',
            'focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
            canStart
              ? 'bg-accent-blue text-text-on-accent hover:brightness-110'
              : 'cursor-not-allowed bg-bg-tertiary text-text-muted',
          )}
        >
          {busy ? '正在建立团队…' : '以队长身份开会话'}
        </button>
      </section>
    );
  },
);
TeamLaunchPanel.displayName = 'TeamLaunchPanel';

export default TeamLaunchPanel;

import React, { useCallback, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { useAgentStore } from '@/shared/store/agentStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useActiveWorkspaceRoot } from '@/shared/store/workspaceStore';
import type { TeamSession } from '@/shared/types/team';

import { useLaunchableAgents } from '../hooks/useLaunchableAgents';
import { useStartTeam } from '../hooks/useStartTeam';
import { useTeamConfigDraft } from '../hooks/useTeamConfigDraft';
import { useTeamOptions } from '../hooks/useTeamOptions';
import { convergeAgentId, isLaunchable, launchGate, startableAgentIds } from '../utils/launchGate';

import ErrorNotice from './ErrorNotice';
import TeamConfigSection from './TeamConfigSection';

/**
 * 队长入口（面板空态）：选 CLI → 以队长身份开会话。
 *
 * # 候选清单的唯一来源：`team_launchable_agents`
 *
 * 谁能当队长**不是**前端能回答的问题：它是后端 `admission.rs` 的那份判据
 * （技能面 × MCP 注入档 × 凭证路），与 `start_team_session` / `team_spawn` 的拒绝
 * 共用同一个纯函数。此前这里筛的是「`enabled` 且 `command` 非空」—— 看上去最无害的
 * 那种前端判据，结果是把 `pi` 这类**注入方式未实现**的 CLI 一起放行，用户点下去才在
 * 后端吃到 `Unsupported: … injects MCP via Subcommand …`（prd R0.4 的反面）。
 *
 * 所以本组件对候选**只做呈现，不做筛选**：清单里每一行都渲染出来，能不能起由
 * `refusal` 决定，理由原样显示。
 *
 * # 能力缺口必须**看得见**，不是悬停才看见
 *
 * `refusal` 是该行下方的可见文字（不是 `title`）：tooltip 在触屏 / 键盘（禁用的按钮
 * 根本不可聚焦）上永远拿不到，而这句话正是用户唯一需要的解释（「缺的是哪个事实」）。
 *
 * # 四条「不要自己发明」的边界
 *
 * 1. **准入**：见上。理由文字由后端给（人读句，已含注入方式），这里不改写、不归纳。
 * 2. **团队根**：走既有单一派生 [`useActiveWorkspaceRoot`]（≡ `workspaceRootOf` 作用在
 *    激活单元 key 上）。自己用 `project.path` 当根会让 worktree 视图下团队开在主仓，
 *    而成员 cwd 与用户在看的树不是同一棵。
 * 3. **团队的项目**：那个根所属的**项目**是 `activeProjectId`，不是从路径反推出来的。
 *    执行环境按项目 id 查表（工作树按设计在项目目录之外，用路径前缀永远对不上），
 *    所以没有激活项目时主按钮不可用，且理由是**可见文字**（禁用按钮不可聚焦）。
 * 4. **起进程之后的动作**：终端接管由 app 层注入（`onOpenLeaderTerminal`），团队域
 *    不认识终端域。
 *
 * # 团队配置：默认值的唯一来源是 `team_options(null)`
 *
 * 成员池 / 上限 / 三个缺省值全部由 [`TeamConfigSection`] 呈现，初值来自后端的
 * `TeamDefaults`（见 [`useTeamConfigDraft`]）—— 本组件里没有第二份默认值。
 * 缺省值拿不到（`options === null`）时主按钮**必须**不可用：不知道缺省值就替用户决定，
 * 等于把后端的默认值抄成了前端常量。
 */

interface TeamLaunchPanelProps {
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  onOpenLeaderTerminal?: (session: TeamSession, title: string) => void;
}

const TeamLaunchPanel: React.FC<TeamLaunchPanelProps> = React.memo(
  ({ onShowToast, onOpenLeaderTerminal }) => {
    // agent 快照只用于**显示名**（`claude-code` → `Claude Code`）。它不参与「谁能起」
    // 的判断 —— 那件事的唯一判据在 `launchable` 里，混进来就会重新长出一套前端准入表。
    const agents = useAgentStore((s) => s.agents);
    const activeProjectId = useProjectStore((s) => s.activeProjectId);
    const projectPath = useProjectStore((s) => s.activeProject?.path);
    // 团队根 = 激活单元的工作树根（唯一派生点，禁止手拼）。
    const workspaceRoot = useActiveWorkspaceRoot(activeProjectId, projectPath);

    const { agents: launchable, loading, error: launchError, reload } = useLaunchableAgents();

    // 团队配置面（`team_options(null)` = 建队前的本机目录）：成员池 / 上限 / 三个缺省值。
    const {
      options: teamOptions,
      loading: optionsLoading,
      error: optionsError,
      reload: reloadOptions,
    } = useTeamOptions(null);
    // 配置草稿：局部 state（不进 zustand），初值全部来自上面的 `teamOptions.defaults`。
    const draft = useTeamConfigDraft(teamOptions);

    const rows = useMemo(() => launchable ?? [], [launchable]);

    /** 用户**点过**的那个 CLI；真正用于提交的 id 由它 + 当前候选派生（见下）。 */
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

    // 可启动清单（唯一判据 `startableAgentIds`，`launchGate` 内部用的是同一个函数）。
    const startableIds = useMemo(() => startableAgentIds(launchable), [launchable]);
    // 选择收敛在**渲染期**完成（`convergeAgentId` 是纯函数）：用 `useEffect` 收敛会多出一帧
    // 「假 disabled」—— 面板刚打开、清单刚落地的那一帧按钮是灰的，而它其实马上就能点。
    const agentId = useMemo(
      () => convergeAgentId(selectedAgentId, startableIds),
      [selectedAgentId, startableIds],
    );

    const { busy, error, start } = useStartTeam({ onShowToast, onOpenLeaderTerminal });
    const { canStart, blockedReason } = useMemo(
      () =>
        launchGate({
          hasActiveProject: activeProjectId !== null,
          hasWorkspaceRoot: workspaceRoot !== null,
          launchable,
          agentId,
          draftValid: draft.valid,
          busy,
        }),
      [activeProjectId, workspaceRoot, launchable, agentId, draft.valid, busy],
    );

    // 只有载荷本身是依赖：整个草稿对象每次渲染都是新引用。
    const teamConfig = draft.config;

    const handleStart = useCallback(() => {
      if (!activeProjectId || !agentId || !workspaceRoot || busy) return;
      // **第二道拦截**：`canStart` 已经把这种状态挡在主按钮之外，这里是给键盘 /
      // 程序化触发（可绕过 `disabled`）留的防守层 —— 把必然被后端拒绝的请求发出去只会
      // 多一条错误信息，不解决任何问题。
      if (!startableIds.includes(agentId)) return;
      void start(activeProjectId, agentId, workspaceRoot, teamConfig);
    }, [activeProjectId, agentId, startableIds, workspaceRoot, busy, start, teamConfig]);

    const nameOf = useCallback(
      (id: string): string => agents?.find((agent) => agent.id === id)?.name ?? id,
      [agents],
    );

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

          {launchable === null ? (
            loading ? (
              <p className="text-meta text-text-muted">正在检查各 CLI 的启动能力…</p>
            ) : (
              // 从没拿到过清单：错误由下方 `role="alert"` 原文显示，这里只说明后果。
              <p className="text-meta text-text-muted">拿不到可启动清单，所以现在还开不了团队。</p>
            )
          ) : rows.length === 0 ? (
            // 后端确实一个 CLI 都没有 —— 不是空下拉，也不是「加载中」。
            <p className="text-meta text-text-muted">
              后端没有返回任何可选的 CLI——清单为空（这不是「加载中」）。先确认 agent 配置已加载。
            </p>
          ) : (
            <ul className="flex flex-col gap-1" aria-label="可选的 CLI">
              {rows.map((row) => {
                const launchableRow = isLaunchable(row);
                const selected = launchableRow && row.agentId === agentId;
                const refusalId = `team-launch-refusal-${row.agentId}`;
                return (
                  <li key={row.agentId} className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      // 被拒的行不可选中：选中一个起不来的 CLI 只会让主按钮变成必然失败。
                      onClick={launchableRow ? () => setSelectedAgentId(row.agentId) : undefined}
                      disabled={!launchableRow}
                      aria-disabled={!launchableRow}
                      aria-pressed={launchableRow ? selected : undefined}
                      aria-describedby={launchableRow ? undefined : refusalId}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left',
                        'focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
                        !launchableRow
                          ? 'cursor-not-allowed border-border bg-bg-secondary'
                          : selected
                            ? 'border-accent-blue bg-bg-selected'
                            : 'border-border bg-bg-secondary hover:bg-bg-hover',
                      )}
                    >
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-meta',
                          launchableRow ? 'text-text-primary' : 'text-text-muted',
                        )}
                      >
                        {nameOf(row.agentId)}
                      </span>
                      <span className="shrink-0 font-mono text-micro text-text-muted">
                        {row.agentId}
                      </span>
                    </button>
                    {row.refusal ? (
                      // 可见文字，不是 `title`：禁用的按钮不可聚焦，触屏也没有悬停。
                      <p
                        id={refusalId}
                        className="whitespace-pre-wrap break-words text-micro text-text-muted"
                      >
                        {row.refusal}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {/* 后端原文 + 重试（重试入口只看错误，不看有没有拿到过清单）。
              这块的形态与团队配置 / 团队列表共用 `ErrorNotice`：三处不许各写一份。 */}
          <ErrorNotice message={launchError} retryLabel="重新检查" onRetry={reload} />
        </div>

        <TeamConfigSection
          options={teamOptions}
          loading={optionsLoading}
          error={optionsError}
          onRetry={reloadOptions}
          draft={draft}
          nameOf={nameOf}
        />

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

        {draft.values?.approvalPolicy === 'bypass' ? (
          // 旁路审批的后果**不隐蔽**：它就在主按钮上方，且出现在按下去之前。
          <p role="note" className="text-micro text-accent-orange">
            ⚠ 已选「旁路审批」：成员写盘前不会有人确认。只在完全信任这个队的成员时使用。
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

        {blockedReason ? (
          // 灰按钮 + 原因：只禁用不解释，用户会以为面板坏了。
          <p className="text-micro text-text-muted">{blockedReason}</p>
        ) : null}
      </section>
    );
  },
);
TeamLaunchPanel.displayName = 'TeamLaunchPanel';

export default TeamLaunchPanel;

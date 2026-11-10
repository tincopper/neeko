import { ArrowLeft } from 'lucide-react';
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
import { useTeamRoles } from '../hooks/useTeamRoles';
import { convergeAgentId, isLaunchable, launchGate, startableAgentIds } from '../utils/launchGate';

import LeadPickerSection from './LeadPickerSection';
import RoleLibraryBlock, { TeamRootRow } from './RoleLibraryBlock';
import StepHead from './StepHead';
import TeamConfigSection from './TeamConfigSection';
import TeamLaunchFooter from './TeamLaunchFooter';

/**
 * 队长入口（面板空态）：选 CLI → 以队长身份开会话。
 *
 * # 候选清单的唯一来源：`team_launchable_agents`
 *
 * 谁能当队长**不是**前端能回答的问题：它是后端 `admission.rs` 的那份判据
 * （技能面 × MCP 注入档 × 凭证路），与 `start_team_session` / `team_spawn` 的拒绝
 * 共用同一个纯函数。本组件对候选**只做呈现，不做筛选**（呈现层的两类分流见
 * [`LeadPickerSection`]）。
 *
 * # 四条「不要自己发明」的边界
 *
 * 1. **准入**：理由文字由后端给（人读句，已含注入方式），这里不改写、不归纳。
 * 2. **团队根**：走既有单一派生 [`useActiveWorkspaceRoot`]（≡ `workspaceRootOf` 作用在
 *    激活单元 key 上）。自己用 `project.path` 当根会让 worktree 视图下团队开在主仓。
 * 3. **团队的项目**：那个根所属的**项目**是 `activeProjectId`，不是从路径反推的。
 *    执行环境按项目 id 查表，所以没有激活项目时主按钮不可用，理由是**可见文字**。
 * 4. **起进程之后的动作**：终端接管由 app 层注入（`onOpenLeaderTerminal`）。
 *
 * # footer 与角色库
 *
 * 主按钮吸附在 footer（见 [`TeamLaunchFooter`]）：提交动作永远在场。
 * 角色库是**管理面**（编辑 persona 预设），不是建队路径上的必经项 —— 建队只消费
 * 它的「缺省角色」一个下拉（在配置区里），所以默认折叠，`N` 计数让它不藏没影。
 */
interface TeamLaunchPanelProps {
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  onOpenLeaderTerminal?: (
    session: TeamSession,
    title: string,
    /** 队长的 agent（tab 栏品牌图标用；取自建队响应，不依赖快照时序）。 */
    agentId: string | undefined,
  ) => void;
  /**
   * 返回列表（列表优先 + 视图推入的「退栈」）。
   *
   * 由宿主注入 —— 本组件不认识导航。`undefined` = 作为独立面板使用（测试 / 未来
   * 的独立入口），此时不渲染返回钮。
   */
  onBack?: () => void;
}

const TeamLaunchPanel: React.FC<TeamLaunchPanelProps> = React.memo(
  ({ onShowToast, onOpenLeaderTerminal, onBack }) => {
    // agent 快照只用于**显示名**（`claude-code` → `Claude Code`）。它不参与「谁能起」
    // 的判断 —— 那件事的唯一判据在 `launchable` 里。
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
    // 角色库（persona 预设）：缺省角色下拉与库管理区共用一份。不接脉冲（它不是团队状态）。
    const teamRoles = useTeamRoles();

    const rows = useMemo(() => launchable ?? [], [launchable]);
    /** 角色库「建议 CLI」的候选（只要真的可启动的；折叠块的展开态不在这里）。 */
    const launchableAgentIds = useMemo(
      () => rows.filter((row) => isLaunchable(row)).map((row) => row.agentId),
      [rows],
    );

    /** 用户**点过**的那个 CLI；真正用于提交的 id 由它 + 当前候选派生。 */
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

    /**
     * pick-or-create 的保存回调（面板包一层 `teamRoles.saveRole`）。
     *
     * 失败**抛出**可读原因（创建卡捕获显示）；成功后 hook 自己重取清单（新角色进所有
     * 下拉），并把预设回给调用方指派。错误原文来自 `saveRole` 的返回值 —— 回读
     * `mutationError` state 会拿到闭包旧值（setState 异步），那是「保存失败却显示兜底
     * 文案」的成因。
     *
     * `roles === null` = 角色库不可用（还没拿到 / 失败），此时不注入，下拉里没有
     * 「＋ 新建角色…」入口（与 `TeamConfigSection` 的契约一致）。
     */
    const handleCreateRole = useCallback(
      async (input: { name: string; preamble: string; cliPreference: string | null }) => {
        const result = await teamRoles.saveRole({
          name: input.name,
          preamble: input.preamble,
          cliPreference: input.cliPreference,
          approvalPolicy: null,
          defaultWorkspace: null,
          createdAt: Date.now(),
        });
        if (!result.ok) {
          throw new Error(result.error ?? '保存角色失败');
        }
        return {
          ...input,
          approvalPolicy: null,
          defaultWorkspace: null,
          createdAt: Date.now(),
        };
      },
      [teamRoles],
    );

    /** 角色库可用（拿到清单）时才注入保存回调；否则下拉里没有「＋ 新建角色…」入口。 */
    const createRoleProp = teamRoles.roles === null ? undefined : handleCreateRole;

    const nameOf = useCallback(
      (id: string): string => agents?.find((agent) => agent.id === id)?.name ?? id,
      [agents],
    );

    /**
     * footer 的**实时摘要**：这支队伍按下去之后长什么样，一句话说完。
     *
     * 派生自草稿（渲染期，不进 state）—— 草稿变它就变，没有任何一处需要「记得刷新」。
     * 角色名用**预设名**（不是成员位名）：摘要回答「谁带什么人设」。
     */
    const createSummary = useMemo(() => {
      const values = draft.values;
      if (!values) return null;
      const parts: string[] = [];
      // 成员段：先汇总成一行，再整体 push —— 逐个 push 会让第二个成员之后的名字
      // 重复出现在摘要里（「2 名成员（A / B） · B · …」）。
      if (values.selectedIds.length > 0) {
        const staffed = values.selectedIds
          .map((agentId) => {
            const persona = values.roleByAgent[agentId];
            const label = nameOf(agentId);
            return persona ? `${label}→${persona}` : label;
          })
          .join(' / ');
        parts.push(`${values.selectedIds.length} 名成员（${staffed}）`);
      }
      if (values.persona) parts.push(`缺省角色 ${values.persona}`);
      parts.push(values.workspace === 'read_only' ? '只读' : '共享工作区');
      parts.push(
        values.approvalPolicy === 'queue'
          ? '队列审批'
          : values.approvalPolicy === 'interactive'
            ? '交互审批'
            : '旁路审批',
      );
      return parts.join(' · ');
    }, [draft.values, nameOf]);

    return (
      <section aria-label="新建团队" className="flex min-h-0 flex-1 flex-col">
        {/* 返回头：列表优先 + 视图推入的「退栈」。返回是导航（不清草稿 —— 用户只是
            去列表看一眼，回来草稿还在）；清草稿是刷新/成功后的事。 */}
        <header className="flex items-center gap-2 border-b border-border px-2 py-2">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="返回团队列表"
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-md text-text-secondary',
                'hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
              )}
            >
              <ArrowLeft size={15} aria-hidden="true" />
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="text-ui font-semibold text-text-primary">新建团队</div>
            <div className="text-micro text-text-muted">三步：队长 → 成员与角色 → 默认值</div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
          {/* 步骤 1 */}
          <StepHead n={1} title="队长用哪个 CLI" hint="启动后它拿到工具面与任务板" />

          <LeadPickerSection
            launchable={launchable}
            loading={loading}
            error={launchError}
            onRetry={reload}
            agentId={agentId}
            onSelect={setSelectedAgentId}
            nameOf={nameOf}
          />

          {/* 步骤 2 */}
          <StepHead n={2} title="成员与角色" hint="每个成员位可预设 persona" />
          <TeamConfigSection
            options={teamOptions}
            loading={optionsLoading}
            error={optionsError}
            onRetry={reloadOptions}
            draft={draft}
            nameOf={nameOf}
            roles={teamRoles.roles}
            onCreateRole={createRoleProp}
          />

          {/* 角色库：管理面默认折叠（计数让它可被找到，不藏没影）。
              展开态在本组件的就近 state 里，面板不持有该字段。 */}
          <RoleLibraryBlock
            roles={teamRoles}
            nameOf={nameOf}
            agentIds={launchableAgentIds}
            onShowToast={onShowToast}
          />

          {/* 步骤 3 */}
          <StepHead n={3} title="默认值与团队根" hint="全部可不改" />
          <TeamRootRow workspaceRoot={workspaceRoot} />
        </div>

        {/* 吸附 footer：CTA 永远在场；警示与理由随行（后果必须在按下去之前可见） */}
        <TeamLaunchFooter
          busy={busy}
          canStart={canStart}
          error={error}
          bypassSelected={draft.values?.approvalPolicy === 'bypass'}
          blockedReason={blockedReason}
          summary={createSummary}
          onStart={handleStart}
        />
      </section>
    );
  },
);
TeamLaunchPanel.displayName = 'TeamLaunchPanel';

export default TeamLaunchPanel;

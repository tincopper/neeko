import React from 'react';

import { cn } from '@/lib/utils';
import type { ApprovalPolicy, RolePreset, TeamOptions } from '@/shared/types/team';
import { Input, Radio } from '@/ui';

import {
  MEMBER_LIMIT_MAX,
  MEMBER_LIMIT_MIN,
  type TeamConfigDraft,
} from '../hooks/useTeamConfigDraft';
import type { LaunchWorkspace } from '../types';

import ErrorNotice from './ErrorNotice';
import TeamMemberPool from './TeamMemberPool';

/**
 * 建队面板的**团队配置区**：成员池 / 上限 / 三个缺省值。
 *
 * 团队名**不在这里**（它是这支队伍的主语，排在面板页首 —— 见 `TeamLaunchPanel`）；本节只装
 * `TeamConfig` 的字段。
 *
 * # 默认值的唯一来源是 `team_options(null)`
 *
 * 这里**没有**任何写死的 4 / `shared` / `queue`：所有初值都从 `options.defaults` 播种
 * （见 [`TeamConfigDraft`](../../hooks/useTeamConfigDraft.ts)）。缺省值还没落地时
 * （`options === null`）本区不渲染表单 —— 不知道缺省值就不该替用户决定。
 *
 * # 能力缺口必须看得见
 *
 * 池子里 `refusal` 非空的行禁用并**把理由作为可见文字**（不是 `title`）：与队长选择行
 * 同一套呈现 —— 禁用控件不可聚焦、触屏也没有悬停，而这句话正是用户唯一需要的解释。
 *
 * 今天的 `team_options` 实际上已经把不能启动的行过滤掉了（`options.rs::resolve`），
 * 所以这条分支是**给同一份类型留的防守**：`TeamOptions.members` 与
 * `team_launchable_agents` 共用一个 wire 形状，哪天解析侧改成「保留被拒行 + 理由」，
 * 面板不需要改。
 *
 * # 组件的边界
 *
 * 本组件只做「呈现 + 转发」：状态机在 hook（[`useTeamConfigDraft`]），提交在主按钮
 * （`TeamLaunchPanel`）。它不认识 `start_team_session`，也不认识 store。
 */

interface TeamConfigSectionProps {
  /** 后端给的配置面；`null` = 还没拿到（此时不可建队）。 */
  options: TeamOptions | null;
  loading: boolean;
  /** `team_options` 的失败原文。 */
  error: string | null;
  /** 重试入口（失败时唯一能自救的动作）。 */
  onRetry: () => void;
  draft: TeamConfigDraft;
  /** `agentId` → 显示名（唯一的显示名来源是 agent 快照，由面板注入）。 */
  nameOf: (agentId: string) => string;
  /** 角色库（缺省角色下拉的数据源）；`null` = 还没拿到（下拉只留「无人设」）。 */
  roles: RolePreset[] | null;
  /**
   * pick-or-create 的保存回调（面板包一层 `teamRoles.saveRole`）。
   * `undefined` = 角色库不可用（下拉里没有「＋ 新建角色…」入口）。
   */
  onCreateRole?: (input: {
    name: string;
    preamble: string;
    cliPreference: string | null;
  }) => Promise<RolePreset | null>;
}

/** 工作区两选的文案。**含义写清**：两个词本身不解释任何事。 */
const WORKSPACE_LABEL: Record<LaunchWorkspace, string> = {
  shared: '共享（全队同一工作区）',
  read_only: '只读（成员不得写盘）',
};

/** 审批三选的文案（旁路的后果不在这里讲 —— 它由主按钮上方那行风险提示讲）。 */
const APPROVAL_LABEL: Record<ApprovalPolicy, string> = {
  queue: '待批队列（默认，不打断队长）',
  interactive: '逐个交互批准（在成员自己的终端里问）',
  bypass: '旁路（不审批）',
};

const APPROVAL_ORDER: ApprovalPolicy[] = ['queue', 'interactive', 'bypass'];
const WORKSPACE_ORDER: LaunchWorkspace[] = ['shared', 'read_only'];

const TeamConfigSection: React.FC<TeamConfigSectionProps> = React.memo(
  ({ options, loading, error, onRetry, draft, nameOf, roles, onCreateRole }) => {
    const values = draft.values;

    return (
      // 字号的唯一落点：`text-meta` 放在容器上由子元素**继承**。
      // 不能与颜色类一起交给 `cn()` —— `twMerge` 把 `text-meta` 与 `text-text-*`
      // 归进同一个 `text-` 组，两者只能活一个（实测：`cn('text-text-secondary','text-meta')`
      // 产出 `text-meta`，颜色被丢掉）。
      <section aria-label="团队配置" className="flex flex-col gap-2 text-meta">
        <h3 className="text-meta font-semibold text-text-secondary">团队配置</h3>

        {options === null ? (
          // 缺省值没到手：只有两种话可说 —— 「正在读」与「读不到」。
          loading ? (
            <p className="text-meta text-text-muted">正在读取团队配置的默认值…</p>
          ) : (
            <p className="text-meta text-text-muted">
              拿不到团队配置的默认值，所以现在还开不了团队（默认值没有第二个来源）。
            </p>
          )
        ) : values === null ? (
          <p className="text-meta text-text-muted">正在套用后端的默认值…</p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-micro text-text-muted">
                成员池：允许哪些 CLI 当成员（队长只能从这里挑）。 这是候选菜单，不是要起满的人数 ——
                实际启动几位由队长按任务数指派决定。
              </span>
              {options.members.length === 0 ? (
                <p className="text-meta text-text-muted">
                  后端没有返回任何可当成员的 CLI —— 空池意味着一个成员都加不进来。
                </p>
              ) : (
                <TeamMemberPool
                  members={options.members}
                  roleByAgent={values.roleByAgent}
                  selectedIds={values.selectedIds}
                  roles={roles}
                  onCreateRole={onCreateRole}
                  onToggleMember={draft.toggleMember}
                  onSetRole={draft.setRoleFor}
                  nameOf={nameOf}
                />
              )}
              {values.selectedIds.length === 0 ? (
                <p className="text-micro text-accent-red">
                  至少勾选一个成员，否则无法建队（空池在后端是「不限制」，不是这里的意思）。
                </p>
              ) : null}
            </div>

            {/* 上限 / 工作区 / 审批：三个「一键决策」排成紧凑组 —— 默认值来自
                team_options，多数用户一项都不用改，所以它们不配占满首屏。 */}
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="team-config-max-members" className="text-micro text-text-muted">
                成员上限（不含队长）
              </label>
              <div className="flex flex-col items-end">
                <Input
                  id="team-config-max-members"
                  type="number"
                  size="sm"
                  className="w-16"
                  min={MEMBER_LIMIT_MIN}
                  max={MEMBER_LIMIT_MAX}
                  value={values.maxMembers}
                  onChange={(e) => draft.setMaxMembers(e.target.value)}
                  aria-invalid={draft.maxMembersError !== null}
                />
                {draft.maxMembersError ? (
                  <p className="text-micro text-accent-red">{draft.maxMembersError}</p>
                ) : null}
              </div>
            </div>

            <fieldset className="flex flex-col gap-1">
              <legend className="text-micro text-text-muted">
                默认工作区（成员没指定时用哪个）
              </legend>
              <div className="grid grid-cols-2 gap-1.5">
                {WORKSPACE_ORDER.map((workspace) => (
                  <div
                    key={workspace}
                    className={cn(
                      'rounded-md border px-2 py-1 transition-colors',
                      values.workspace === workspace
                        ? 'border-accent-blue bg-accent-blue/5'
                        : 'border-border bg-bg-primary',
                    )}
                  >
                    <Radio
                      name="team-default-workspace"
                      checked={values.workspace === workspace}
                      onChange={() => draft.setWorkspace(workspace)}
                      className="w-full"
                    >
                      {WORKSPACE_LABEL[workspace]}
                    </Radio>
                  </div>
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-1">
              <legend className="text-micro text-text-muted">默认审批（成员写盘前怎么确认）</legend>
              <div className="grid grid-cols-3 gap-1.5">
                {APPROVAL_ORDER.map((policy) => (
                  <div
                    key={policy}
                    className={cn(
                      'rounded-md border px-2 py-1 transition-colors',
                      values.approvalPolicy === policy
                        ? 'border-accent-blue bg-accent-blue/5'
                        : 'border-border bg-bg-primary',
                    )}
                  >
                    <Radio
                      name="team-default-approval"
                      checked={values.approvalPolicy === policy}
                      onChange={() => draft.setApprovalPolicy(policy)}
                      className="w-full"
                    >
                      {APPROVAL_LABEL[policy]}
                    </Radio>
                  </div>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="team-config-default-model" className="text-micro text-text-muted">
                  默认模型
                </label>
                <Input
                  id="team-config-default-model"
                  size="sm"
                  value={values.model}
                  placeholder="CLI 自己的默认"
                  onChange={(e) => draft.setModel(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="team-config-default-persona" className="text-micro text-text-muted">
                  缺省角色
                </label>
                <select
                  id="team-config-default-persona"
                  size={1}
                  value={values.persona}
                  onChange={(e) => draft.setPersona(e.target.value)}
                  className="h-7 rounded-md border border-border bg-bg-primary px-2 text-meta text-text-primary focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
                >
                  <option value="">无人设</option>
                  {(roles ?? []).map((role) => (
                    <option key={role.name} value={role.name}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {roles !== null && roles.length === 0 ? (
              <p className="text-micro text-text-muted">
                角色库还没有预设 —— 展开下方「角色库」加一个，就能在这里给成员默认人设。
              </p>
            ) : null}
          </>
        )}

        {/* 后端原文（不改写）+ 重试；形态与队长入口 / 团队列表共用 `ErrorNotice`。 */}
        <ErrorNotice message={error} retryLabel="重新读取团队配置" onRetry={onRetry} />
      </section>
    );
  },
);
TeamConfigSection.displayName = 'TeamConfigSection';

export default TeamConfigSection;

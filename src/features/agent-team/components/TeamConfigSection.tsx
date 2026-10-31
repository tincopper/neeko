import React from 'react';

import { cn } from '@/lib/utils';
import type { ApprovalPolicy, TeamOptions } from '@/shared/types/team';
import { Input, Radio } from '@/ui';

import {
  MEMBER_LIMIT_MAX,
  MEMBER_LIMIT_MIN,
  type LaunchWorkspace,
  type TeamConfigDraft,
} from '../hooks/useTeamConfigDraft';

/**
 * 建队面板的**团队配置区**：成员池 / 上限 / 三个缺省值。
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
  ({ options, loading, error, onRetry, draft, nameOf }) => {
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
                成员池：允许哪些 CLI 当成员（点开名单后队长只能从这里挑）
              </span>
              {options.members.length === 0 ? (
                <p className="text-meta text-text-muted">
                  后端没有返回任何可当成员的 CLI —— 空池意味着一个成员都加不进来。
                </p>
              ) : (
                <ul aria-label="成员池" className="flex flex-col gap-1">
                  {options.members.map((row) => {
                    const launchable = row.refusal === null;
                    const refusalId = `team-config-refusal-${row.agentId}`;
                    return (
                      <li key={row.agentId} className="flex flex-col gap-0.5">
                        <label
                          className={cn(
                            'flex items-center gap-2',
                            launchable
                              ? 'cursor-pointer text-text-primary'
                              : 'cursor-not-allowed text-text-muted',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="size-3.5 shrink-0 accent-[var(--accent-blue,#4a9eff)] disabled:cursor-not-allowed"
                            checked={launchable && values.selectedIds.includes(row.agentId)}
                            disabled={!launchable}
                            aria-describedby={launchable ? undefined : refusalId}
                            onChange={(e) => draft.toggleMember(row.agentId, e.target.checked)}
                          />
                          <span className="truncate">{nameOf(row.agentId)}</span>
                        </label>
                        <span className="pl-5 font-mono text-micro text-text-muted">
                          {row.agentId}
                        </span>
                        {row.refusal ? (
                          // 可见文字，不是 `title`（同队长选择行）。
                          <p
                            id={refusalId}
                            className="pl-5 whitespace-pre-wrap break-words text-micro text-text-muted"
                          >
                            {row.refusal}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              {values.selectedIds.length === 0 ? (
                <p className="text-micro text-accent-red">
                  至少勾选一个成员，否则无法建队（空池在后端是「不限制」，不是这里的意思）。
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <label htmlFor="team-config-max-members" className="text-meta text-text-secondary">
                  成员上限（不含队长）
                </label>
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
              </div>
              {draft.maxMembersError ? (
                <p className="text-micro text-accent-red">{draft.maxMembersError}</p>
              ) : null}
            </div>

            <fieldset className="flex flex-col gap-1">
              <legend className="text-micro text-text-muted">
                默认工作区（成员没指定时用哪个）
              </legend>
              {WORKSPACE_ORDER.map((workspace) => (
                <Radio
                  key={workspace}
                  name="team-default-workspace"
                  checked={values.workspace === workspace}
                  onChange={() => draft.setWorkspace(workspace)}
                >
                  {WORKSPACE_LABEL[workspace]}
                </Radio>
              ))}
            </fieldset>

            <fieldset className="flex flex-col gap-1">
              <legend className="text-micro text-text-muted">默认审批（成员写盘前怎么确认）</legend>
              {APPROVAL_ORDER.map((policy) => (
                <Radio
                  key={policy}
                  name="team-default-approval"
                  checked={values.approvalPolicy === policy}
                  onChange={() => draft.setApprovalPolicy(policy)}
                >
                  {APPROVAL_LABEL[policy]}
                </Radio>
              ))}
            </fieldset>

            <div className="flex flex-col gap-1">
              <label htmlFor="team-config-default-model" className="text-micro text-text-muted">
                默认模型
              </label>
              <Input
                id="team-config-default-model"
                size="sm"
                value={values.model}
                placeholder="留空 = 用该 CLI 自己的默认"
                onChange={(e) => draft.setModel(e.target.value)}
              />
            </div>
          </>
        )}

        {error ? (
          // 后端错误原文（不改写：唯一有用的信息是它）。
          <p role="alert" className="whitespace-pre-wrap text-meta text-accent-red">
            {error}
          </p>
        ) : null}

        {error ? (
          // 重试入口只看错误：首次就失败时正是最需要它的时候。
          <button
            type="button"
            onClick={onRetry}
            className="self-start rounded px-1.5 py-0.5 text-micro text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
          >
            重新读取团队配置
          </button>
        ) : null}
      </section>
    );
  },
);
TeamConfigSection.displayName = 'TeamConfigSection';

export default TeamConfigSection;

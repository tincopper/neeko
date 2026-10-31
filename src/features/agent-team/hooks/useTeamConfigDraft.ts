import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ApprovalPolicy, TeamConfig, TeamDefaults, TeamOptions } from '@/shared/types/team';

/**
 * 建队面板的**配置草稿**（局部表单状态，不进 zustand）。
 *
 * # 为什么是局部 state
 *
 * 用户勾了一半的成员池、填了一半的上限，都属于「一次建队动作的中间态」：换面板、刷新、
 * 建队成功之后它就该消失。放进 store 会让「上次没提交的草稿」在下一次建队时悄悄生效
 * （`src/AGENTS.md` 状态管理：状态放在最近的共同祖先；同一事实只有一个表示）。
 * 只有**提交结果**（团队 id / 快照）才进 `teamStore` —— 那是后端的事实。
 *
 * # 默认值没有第二个来源
 *
 * 所有字段的初值都来自 [`TeamDefaults`]（`team_options` 的 `defaults`），本文件里
 * **不存在**任何写死的 4 / `shared` / `queue`：草稿在缺省值到手之前是 `null`，
 * 表单不渲染、也不可提交。写死一份前端默认值就是第二份默认值，后端改默认值后
 * 面板会安静地继续提交过时的缺省，而两份都自洽、没有任何一处报错。
 *
 * # 提交载荷只含**改过**的字段
 *
 * [`TeamConfig`] 的每个字段缺省即后端默认。把 `TeamDefaults` 原样回传等于把后端默认值
 * 抄成前端常量 —— 所以 [`TeamConfigDraft.config`] 逐字段与缺省值比对，只投影真的改过的
 * 那几项（空串 / 空数组视为「没设置」）。
 */

/** v1 的 UI 只提供这两个工作区（`worktree` 需要路径选择器，下一轮接）。 */
export type LaunchWorkspace = 'shared' | 'read_only';

/**
 * 成员上限的合法区间（镜像 `src-tauri/src/agent/team/types.rs` 的
 * `1..=MAX_MEMBERS_LIMIT`）。
 *
 * `team_options` **不回带区间**，所以这是前端唯一的一份副本 —— 它的用途只有一个：
 * 别把必然被后端拒绝的请求发出去（后端仍会在写库前拒绝，判据不在这边）。
 */
export const MEMBER_LIMIT_MIN = 1;
export const MEMBER_LIMIT_MAX = 8;

/** 草稿的可编辑字段（一律以「后端缺省值」为初值）。 */
export interface TeamConfigValues {
  /** 成员池勾选（**顺序恒为 `options.members` 的行序**，同一个集合不会产生两种载荷）。 */
  selectedIds: string[];
  /** 上限输入框原文：`string` 才能表达「空」与「越界」这两种不可提交态。 */
  maxMembers: string;
  workspace: LaunchWorkspace;
  approvalPolicy: ApprovalPolicy;
  /** 缺省模型；空串 = 用各 CLI 自己的默认。 */
  model: string;
}

export interface TeamConfigDraft {
  /** `null` = 缺省值还没到（`team_options` 未落地）—— 表单不渲染，也不可提交。 */
  values: TeamConfigValues | null;
  toggleMember: (agentId: string, next: boolean) => void;
  setMaxMembers: (next: string) => void;
  setWorkspace: (next: LaunchWorkspace) => void;
  setApprovalPolicy: (next: ApprovalPolicy) => void;
  setModel: (next: string) => void;
  /** 上限输入的即时错误（`null` = 合法）。 */
  maxMembersError: string | null;
  /** 只含**非缺省**字段的 `start_team_session` 入参。 */
  config: TeamConfig;
  /** 可以提交：缺省值已到手 + 至少一个成员 + 上限合法。 */
  valid: boolean;
}

/**
 * 缺省值 → 草稿初值。
 *
 * `defaultWorkspace` 可能是 `{worktree:{path}}`，而 v1 的两选面里没有它 ⇒ 落到 `shared`。
 * 这不会丢掉用户的既有配置：本面板只服务「还没有团队」这一态（`team_options(null)`
 * 的缺省恒为 `shared`，见 `TeamConfig::default`），而真的选中 `shared` 与缺省不同时，
 * 它会被当作「改过」显式提交 —— 不假装同步过。
 */
function seedValues(defaults: TeamDefaults): TeamConfigValues {
  return {
    selectedIds: defaults.allowedAgentIds,
    maxMembers: String(defaults.maxMembers),
    workspace: defaults.defaultWorkspace === 'read_only' ? 'read_only' : 'shared',
    approvalPolicy: defaults.defaultApprovalPolicy,
    model: defaults.defaultModel ?? '',
  };
}

/** 两个 id 清单是否是同一个集合（顺序无关：池子的语义是集合，不是列表）。 */
function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  return b.every((id) => left.has(id));
}

/** 上限原文 → 错误文案（`null` = 合法）。 */
function validateMaxMembers(raw: string): string | null {
  const text = raw.trim();
  const parsed = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(parsed)) {
    return `上限要填整数（${MEMBER_LIMIT_MIN}..${MEMBER_LIMIT_MAX}）。`;
  }
  if (parsed < MEMBER_LIMIT_MIN || parsed > MEMBER_LIMIT_MAX) {
    return `上限必须在 ${MEMBER_LIMIT_MIN}..${MEMBER_LIMIT_MAX} 之间：当前填的是 ${parsed}。`;
  }
  return null;
}

export function useTeamConfigDraft(options: TeamOptions | null): TeamConfigDraft {
  const [values, setValues] = useState<TeamConfigValues | null>(null);

  const defaults = options?.defaults ?? null;

  // 缺省值到手（或换了一份）→ 重新播种。重新播种是对的：`reload` 意味着后端的默认值
  // 变了，保留用户的半份草稿会提交一套「上一次默认值 + 本次改动」的混合体。
  useEffect(() => {
    if (defaults === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 异步缺省值落地后播种（项目既有模式，见 useLaunchableAgents）
    setValues(seedValues(defaults));
  }, [defaults]);

  const memberIds = useMemo(() => options?.members.map((row) => row.agentId) ?? [], [options]);

  const update = useCallback((patch: (prev: TeamConfigValues) => TeamConfigValues) => {
    setValues((prev) => (prev === null ? prev : patch(prev)));
  }, []);

  const toggleMember = useCallback(
    (agentId: string, next: boolean) => {
      update((prev) => {
        const wanted = new Set(prev.selectedIds);
        if (next) wanted.add(agentId);
        else wanted.delete(agentId);
        // 按 `options.members` 的行序重建（后端已排序）：同一个集合只有一种载荷形态。
        return { ...prev, selectedIds: memberIds.filter((id) => wanted.has(id)) };
      });
    },
    [memberIds, update],
  );

  const setMaxMembers = useCallback(
    (next: string) => update((prev) => ({ ...prev, maxMembers: next })),
    [update],
  );
  const setWorkspace = useCallback(
    (next: LaunchWorkspace) => update((prev) => ({ ...prev, workspace: next })),
    [update],
  );
  const setApprovalPolicy = useCallback(
    (next: ApprovalPolicy) => update((prev) => ({ ...prev, approvalPolicy: next })),
    [update],
  );
  const setModel = useCallback(
    (next: string) => update((prev) => ({ ...prev, model: next })),
    [update],
  );

  const maxMembersError = useMemo(
    () => (values === null ? null : validateMaxMembers(values.maxMembers)),
    [values],
  );

  const config = useMemo<TeamConfig>(() => {
    if (defaults === null || values === null) return {};
    const next: TeamConfig = {};
    if (!sameIdSet(values.selectedIds, defaults.allowedAgentIds)) {
      next.allowedAgentIds = values.selectedIds;
    }
    const model = values.model.trim();
    if (model !== '' && model !== (defaults.defaultModel ?? '')) next.defaultModel = model;
    if (values.workspace !== defaults.defaultWorkspace) next.defaultWorkspace = values.workspace;
    if (values.approvalPolicy !== defaults.defaultApprovalPolicy) {
      next.defaultApprovalPolicy = values.approvalPolicy;
    }
    // 越界不发：`valid` 已经挡住提交，这里再挡一次是为了让 `config` 在任何时刻都是
    // 「可以原样发给后端」的载荷（不会因为半句非法输入而整体失败）。
    if (maxMembersError === null && Number(values.maxMembers) !== defaults.maxMembers) {
      next.maxMembers = Number(values.maxMembers);
    }
    return next;
  }, [defaults, values, maxMembersError]);

  const valid =
    defaults !== null &&
    values !== null &&
    values.selectedIds.length > 0 &&
    maxMembersError === null;

  return {
    values,
    toggleMember,
    setMaxMembers,
    setWorkspace,
    setApprovalPolicy,
    setModel,
    maxMembersError,
    config,
    valid,
  };
}

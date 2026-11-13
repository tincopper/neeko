import type { MemberRole, MemberState, MemberStatusView } from '@/shared/types/team';

/**
 * 六态徽标的**唯一**文案与语义映射（`prototype-agent-team.html` 视图 ②）。
 *
 * # 为什么必须是一个纯函数
 *
 * AC2 的判据是「`idle` + `unverified` 与 `idle` + `verified` 在 UI 上**可区分**」。
 * 只按 `state` 出文案时两者都写「空闲」——用户会以为活干完了，而任务其实还在进行中。
 * 所以文案必须由 (`state`, `verification`) **两个维度**共同决定，并且每次都要带上
 * 可访问文本（`aria-label` / `title`），否则「视觉可区分」在无障碍工具里等于不存在。
 *
 * 合并任意两个状态都会丢信息，因此这里刻意不做「简化版」：
 *
 * | state | 文案 | 依据 |
 * | --- | --- | --- |
 * | `spawned` | 已建立 | 进程尚未跑起来 |
 * | `running` | 运行中 | 收到过 TurnStart |
 * | `awaiting` | 待批准 | 审批门的家（进待批队列）|
 * | `idle` | 空闲 ⚠ 未声明 / 空闲 ✓ 已声明 | **由 `verification` 决定**，见 AC2 |
 * | `done` | 完成 | 有 L2 显式声明 |
 * | `failed` | 失败 | 本回合失败 |
 * | `dead` | 已退出 | 进程退出（L4）|
 * | `stalled` | 可能等待输入 | L3 静默超阈值 —— **禁止**写「正在工作」|
 */

/** 徽标的语义色（映射到项目 token 的 className，不在组件里拼颜色）。 */
export type MemberBadgeTone =
  | 'running'
  | 'idle'
  | 'awaiting'
  | 'done'
  | 'failed'
  | 'offline'
  | 'stalled'
  | 'unverified';

export interface MemberBadge {
  /** 视觉文案（人读的短标签）。 */
  text: string;
  /** 语义色（组件映射到 token class）。 */
  tone: MemberBadgeTone;
  /**
   * 可访问文本：包含完整原因（视觉文案太短，读屏用户拿不到「为什么」）。
   *
   * AC2 的判据落在本字段 + `text` 上：`idle`+`unverified` 与 `idle`+`verified`
   * 在**两者**上都不同。
   */
  ariaLabel: string;
}

const STATE_TEXT: Record<MemberState, string> = {
  spawned: '已建立',
  running: '运行中',
  awaiting: '待批准',
  idle: '空闲',
  done: '完成',
  failed: '失败',
  offline: '已退出',
  stalled: '可能等待输入',
};

const STATE_TONE: Record<MemberState, MemberBadgeTone> = {
  spawned: 'idle',
  running: 'running',
  awaiting: 'awaiting',
  idle: 'idle',
  done: 'done',
  failed: 'failed',
  offline: 'offline',
  stalled: 'stalled',
};

/** 「空闲」的两种取证形态 —— 文案与 tone 都不同（AC2）。 */
const IDLE_UNVERIFIED: MemberBadge = {
  text: '空闲 ⚠ 未声明',
  tone: 'unverified',
  ariaLabel: '空闲 ⚠ 未声明：只收到回合结束信号，任务仍在进行中，没有人认领这次「完成」',
};

const IDLE_VERIFIED: MemberBadge = {
  text: '空闲 ✓ 已声明',
  tone: 'idle',
  ariaLabel: '空闲 ✓ 已声明：已收到任务的显式完成声明',
};

/**
 * 成员一行该显示什么。
 *
 * `verification` 只在 `idle` 上改变文案：`done` 必然是 `verified`（后端只在显式声明后
 * 才写 `Done`），而 `running` / `awaiting` 的「有没有声明」还不是问题。把 ⚠ 挂到所有状态上
 * 会让它在真要提示的地方失去区分度。
 */
export function memberBadge(member: Pick<MemberStatusView, 'state' | 'verification'>): MemberBadge {
  if (member.state === 'idle') {
    return member.verification === 'unverified' ? IDLE_UNVERIFIED : IDLE_VERIFIED;
  }
  const text = STATE_TEXT[member.state];
  return {
    text,
    tone: STATE_TONE[member.state],
    ariaLabel: `${text}：${stateReason(member.state)}`,
  };
}

/** 状态的「为什么」——只出现在 `aria-label` / `title` 里。 */
function stateReason(state: MemberState): string {
  switch (state) {
    case 'spawned':
      return '成员已建好，进程尚未跑起来';
    case 'running':
      return '成员正在干活';
    case 'awaiting':
      return '成员在等审批或输入，需要人动手（进待批队列，不冒泡进队长对话）';
    case 'done':
      return '成员的任务已被显式声明完成';
    case 'failed':
      return '本回合失败';
    case 'offline':
      return '成员进程已退出，任务租约到期后会被回收';
    case 'stalled':
      return '静默超阈值，无法确认它是否正在工作';
    case 'idle':
      return '成员这一轮说完了';
  }
}

/** 角色标签。 */
export function memberRoleLabel(role: MemberRole): string {
  return role === 'lead' ? '队长' : '成员';
}

// 租约文案**不在这里**：它是「同一个任务在花名册与卡片上必须是同一句话」的判据，
// 唯一实现在 `utils/leaseText.ts`（花名册吃后端快照值，卡片吃现算的实时值，
// 两边先收敛成「剩余秒」再交给同一个函数）。本文件只管六态徽标。

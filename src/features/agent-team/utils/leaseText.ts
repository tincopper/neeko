import type { TaskCard } from '@/shared/types/team';

/**
 * 租约剩余量的**唯一**文案函数。
 *
 * # 为什么只剩这一个入参
 *
 * 花名册拿的是后端快照值（`MemberStatusView.leaseRemainingSecs`），卡片与抽屉拿的是
 * `claimedAt + leaseTtl - now` 现算的实时值。两种「剩余量」的**来源**不同（一个随脉冲更新、
 * 一个每秒重算），但**展示**必须是同一个口径 —— 否则同一个任务在两处给出不同的数字
 * （其中一处还会看起来像卡死了：快照值在两脉冲之间不动）。
 *
 * 所以两边先把各自的输入收敛成「**剩余秒**」这一个量，再一起交给 [`leaseText`]：
 *
 * | 读面 | 剩余秒从哪来 | 变化节奏 |
 * | --- | --- | --- |
 * | 花名册（`RosterRow`）| 后端 `leaseRemainingSecs` | 只在脉冲时更新（**快照值**）|
 * | 卡片 / 抽屉（`TaskCardRow` / `MemberDetailTasks`）| [`remainingSecsOf`] 现算 | 每秒 tick（**实时值**）|
 *
 * 注释里写清这两种节奏是必要的：它们会让「同一时刻两处相差几秒」变成预期行为，
 * 而不是一个待修的 bug；真正的缺陷是**格式或三态语义**分叉。
 *
 * # 两态（后端 `view.rs::lease_remaining_secs` 的**有租约**部分）
 *
 * | 剩余秒 | 文案 | 含义 |
 * | --- | --- | --- |
 * | `<= 0` | 租约已超时 | 到期了但还没被回收（回收是静默的，得提前有一抹颜色）|
 * | `> 0` | 租约剩 M:SS | 正常剩余量 |
 *
 * `null`（这个人 / 这个任务没有租约）**不进这个函数**：调用方直接**不渲染**这一行
 * （R3，2026-11-17）。早先它渲染成「无在飞任务」，于是最常见的行（没活的人）每行多一句
 * 灰字；把 `null` 从签名里去掉，是为了让「必须先判空」由类型系统保证，而不是靠每个调用点
 * 记得判。
 */
export interface LeaseText {
  text: string;
  /** 是否紧急（已超时 / 不足 2 分钟）—— 紧急时文案要变色。 */
  urgent: boolean;
}

/**
 * 剩余多少秒算紧急。
 *
 * 回收是**静默**发生的（任务回到 `pending`，没有通知），提前一抹颜色是唯一提示 ——
 * 2 分钟大致等于「用户还来得及去补一句」的那段时间。
 */
export const LEASE_URGENT_SECS = 120;

/** 剩余秒 → 人读文案（两态，见文件头）。`null` 由调用方处理成「不渲染」。 */
export function leaseText(remainingSecs: number): LeaseText {
  if (remainingSecs <= 0) return { text: '租约已超时', urgent: true };
  const minutes = Math.floor(remainingSecs / 60);
  const secs = remainingSecs % 60;
  return {
    text: `租约剩 ${minutes}:${String(secs).padStart(2, '0')}`,
    urgent: remainingSecs <= LEASE_URGENT_SECS,
  };
}

/**
 * 任务自己的剩余秒（`claimedAt + leaseTtl - now`，向上取整到秒）。
 *
 * 取整方向必须与后端 `lease_remaining_secs` 一致（向上取整）：向下取整会让「刚好还剩 1 秒」
 * 显示成 0，于是卡片在还没超时的时候写「已超时」。
 *
 * @param now 时间基准（**注入**，纯函数才算得出来：「剩余」是派生值，不是状态）
 * @returns `null` = 这个任务没有起租（没有租约可展示）
 */
export function remainingSecsOf(
  task: Pick<TaskCard, 'claimedAt' | 'leaseTtl'>,
  now: number,
): number | null {
  if (task.claimedAt === null) return null;
  const remainingMs = task.claimedAt + task.leaseTtl * 1000 - now;
  // `Math.ceil` 对负数会把「已超时 -1ms」取成 0（= 超时），语义正确。
  const secs = Math.ceil(remainingMs / 1000);
  // `Math.ceil(-0.5) === -0`：归一成 `0`，免得下游 `Object.is` / 相等断言被负零坑。
  return secs === 0 ? 0 : secs;
}

/** 卡片 / 抽屉：任务租约文案（`null` = 这个任务没有租约）。 */
export function taskLease(
  task: Pick<TaskCard, 'claimedAt' | 'leaseTtl'>,
  now: number,
): LeaseText | null {
  const remainingSecs = remainingSecsOf(task, now);
  return remainingSecs === null ? null : leaseText(remainingSecs);
}

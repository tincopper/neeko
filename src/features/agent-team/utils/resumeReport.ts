import type { ColdReason, TeamResumeReport } from '@/shared/types/team';

/**
 * 一次 `team_resume` 的结果 → **一句人话**（唯一推导点）。
 *
 * # 为什么不能只报 `resumed.length`
 *
 * 恢复的四个桶回答四个不同的问题，而它们**都可能是用户唯一关心的那个**：
 *
 * | 桶 | 用户的问题 |
 * | --- | --- |
 * | `resumed` | 到底有几个真的接回来了 |
 * | `skippedAlreadyLive` | 我点第二次了，为什么没反应（幂等，不是失败）|
 * | `cold` | 它为什么没回来（没说过话 / 这个 CLI 不支持续接）|
 * | `failed` | 哪个坏了，坏在哪 |
 *
 * 「恢复了 1 个成员」在「另外 3 个只能新开」的现场是一句**误导**：用户会以为团队齐了。
 * 静默少报一个与「什么都没发生」在界面上长得一模一样 —— 那正是本任务要消灭的缺陷类型。
 *
 * # 三条固定口径
 *
 * 1. **`resumed` 永远说出来（含 0）**：「恢复 0 个成员」本身就是结论（一个都没接回来），
 *    而省略它在 `cold` / `failed` 全是空时会让这句话变成空串。
 * 2. **`cold` 带理由文字，不只带数字**：两个理由的修法不同（一个是「它还没说过话」，
 *    另一个是「这个 CLI 没有续接语法」），只报数量等于把可行动的信息丢掉。
 * 3. **`failed` 点名成员 id**：只说「1 个失败」时，用户得自己逐个点开去找是哪一个。
 *
 * 空的桶**不出现**（同「0 待批不显示」的纪律：永远亮着的那句读两次就不再读）。
 * 顺序固定为 `resumed → skipped → cold → failed`，同一份报告在任何地方都是同一句话。
 */
export function describeResumeReport(report: TeamResumeReport): string {
  const parts: string[] = [`恢复 ${report.resumed.length} 个成员`];

  if (report.skippedAlreadyLive.length > 0) {
    // 「跳过」不是「失败」：这些成员的进程一直在跑，恢复对它们是幂等的。
    parts.push(`${report.skippedAlreadyLive.length} 个已有进程`);
  }

  // 逐理由分组（不是逐成员）：两个理由各一句，数字才读得出来。
  // 顺序固定 —— `cold` 是数组，按理由归类后仍按 `COLD_ORDER` 排，不随后端返回顺序抖。
  for (const reason of COLD_ORDER) {
    const count = report.cold.filter((member) => member.reason === reason).length;
    if (count > 0) parts.push(`${count} 个只能新开（${coldReasonText(reason)}）`);
  }

  if (report.failed.length > 0) {
    const ids = report.failed.map((member) => member.memberId).join('、');
    parts.push(`${report.failed.length} 个失败（${ids}）`);
  }

  return parts.join('；');
}

/** 固定的理由顺序（`no_native_session` 在前：它更常见，也更容易被误解成「后端坏了」）。 */
const COLD_ORDER: readonly ColdReason[] = ['no_native_session', 'unsupported_cli'];

/** 理由的**可见**文案。两个理由的修法不同，所以它们不能共用一句「不能恢复」。 */
function coldReasonText(reason: ColdReason): string {
  return reason === 'no_native_session' ? '没有会话记录' : '该 CLI 不支持续接';
}

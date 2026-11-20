import type { TeamSnapshot, TeamSummary } from '@/shared/types/team';

/**
 * 「这个队有几个成员」的**唯一**产出点
 * （`TeamSnapshot` / `TeamSummary` / `TeamStatusView` 三个面都走它）。
 *
 * # 为什么必须收成一个函数
 *
 * 同一个队曾经有两个成员数：面板头数 `snapshot.members.length`（**含队长**），列表行用后端
 * `TeamSummary.memberCount`（**不含队长**、含已 `Dead` 的成员）。两个都「看起来对」，于是
 * 用户在列表上看到「成员 3」、点进去看到「4 成员」—— 不是两个视角，是同一事实的两个答案。
 * `view.rs::TeamSummary::member_count` 的字段注释恰好把这件事列为要避免的：
 * 「那样同一个队会有两个不同的成员数」。
 *
 * 口径裁决：**后端口径**（不含队长，含已退出的成员）。
 *
 * - 「不含队长」：队长不是被 `team_spawn` 拉起来的成员，`maxMembers` 也不把它算进去；
 * - 「含 `Dead`」：已关闭的成员仍占名额（`team_options` 的「还能加几个」与它同源），
 *   改成「只数活着的」会让偏差只在刚好卡在上限时显形。
 *
 * # 一个数字一个来源
 *
 * 三个面都带后端算好的 `memberCount`（`TeamManager::member_count` 唯一的计数实现）。
 * 前端因此**不**自己数花名册：`members.filter(role === 'worker').length` 看起来与后端等价，
 * 但那是一份平行实现 —— 后端哪天改了口径，前端会静默给出另一个数，而两个数都「看起来对」。
 *
 * 花名册标题**不再**另摆一个「N 人（含队长）」（2026-11-17，R4）：同屏两个「人数」正是上面
 * 这段要杜绝的事。成员数只在面板头的 meta 行出现一次，口径就是本函数。
 */
export type MemberCountSource = TeamSummary | TeamSnapshot;

/** 团队有几个成员（后端口径）。面板头与列表行都调它。 */
export function memberCountOf(source: MemberCountSource): number {
  return source.memberCount;
}

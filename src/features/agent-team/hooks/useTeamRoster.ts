import { useEffect } from 'react';

import { useTeamRosterStore, type TeamRosterEntry } from '../store/teamRosterStore';

/**
 * 侧栏团队行的花名册读面：**展开才拉**，结果按队缓存（`store/teamRosterStore`）。
 *
 * # 两个 effect 是两件不同的事，不合并
 *
 * | 触发 | 为什么需要它 |
 * | --- | --- |
 * | 挂载 / 换队（`[teamId]`）| 首次拉取；失败后**折叠再展开**（重新挂载）要重试 |
 * | 被脉冲标脏（`stale`）| 展开期间后端有变化，花名册要跟上 |
 *
 * 合成一个以 `missing || stale || failed` 为条件的 effect 会在后端持续失败时变成
 * **无限重试环**（失败 → 条件为真 → 再请求 → 再失败）。所以「上次失败重试」只绑在
 * 展开这个用户动作上，而脉冲驱动的重取只认 `stale`。
 *
 * `ensure` 自身幂等（在飞 / 干净缓存都不会发请求），所以两个 effect 同时命中是安全的。
 *
 * 返回 `null` = 该队还没有任何花名册数据（首次展开的加载中、或尚未展开）。
 *
 * 入参只有 `teamId`：本 hook 只在**展开时**被挂载（`ProjectTeamRow` 折叠不渲染 children），
 * 所以「折叠态零请求」是结构性的（子块根本不存在），不需要一个恒为 `true` 的 `expanded` 开关。
 */
export function useTeamRoster(teamId: string): TeamRosterEntry | null {
  const entry = useTeamRosterStore((s) => s.rosters[teamId] ?? null);
  const stale = entry?.stale === true;
  const loading = entry?.loading === true;

  // ① 挂载即拉（缺数据 / 标脏 / 上次失败都会在这里被重取 —— 判据在 store 的 `ensure`）。
  useEffect(() => {
    void useTeamRosterStore.getState().ensure(teamId);
  }, [teamId]);

  // ② 被脉冲作废 ⇒ 重取（见下方 `loading` 的一段；只在展开态，即本 hook 挂载期间）。
  //
  // `loading` 进依赖与判据，专门处理「脉冲落在请求**在飞期间**」那一格：那一帧 `stale`
  // 已经是 `true`（本 effect 已经跑过一次），响应落地时 store 只能把它重新标脏
  // （`teamRosterStore::superseded`），而 `stale` 并没有从 `false` 变回 `true` —— 只认
  // `stale` 的 effect 于是**不会再跑**，界面永远停在脉冲前那一版（折叠再展开才自愈）。
  // 带上 `loading` 后，「在飞 → 落地且仍标脏」这一刻（`loading` 由 true 变 false）会再触发一次。
  // 不会成环：`ensure` 同步把 `loading` 置 true、`stale` 置 false，本 effect 立刻短路。
  useEffect(() => {
    if (!stale || loading) return;
    void useTeamRosterStore.getState().ensure(teamId);
  }, [stale, loading, teamId]);

  return entry;
}

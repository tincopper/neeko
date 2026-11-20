import { foregroundTeamId } from '@/shared/selectors/liveSessionSelectors';
import type { ActiveTeam } from '@/shared/store/workspaceStore';
import type { SessionRef, SessionView } from '@/shared/types/liveSessions';
import type { TeamSummary } from '@/shared/types/team';

/**
 * 侧栏**第二级的「当前行」**判据（纯函数，唯一实现）。
 *
 * # 它回答的唯一问题
 *
 * 「此刻第二级的那一行亮着的是不是一个团队？」第二级有两种行 —— 单元（地点）与团队（容器），
 * 同一时刻只允许一行是「当前」。这个判断有两个消费者，都必须拿到**同一个答案**：
 *
 * | 消费者 | 消费形态 |
 * | --- | --- |
 * | 团队行（`ProjectTeamList`） | 团队 id（`data-current` / `row-current`） |
 * | 单元行（`ProjectGitSection` / `WorktreeList` / `ConnectionProjectCard`） | 布尔「团队行是当前 ⇒ 我让出高亮」 |
 *
 * 历史缺陷（连续两轮）都是「两个消费者各答半个问题」造成的：团队行按「前台会话 ∪ 我点过哪一行」，
 * 单元行只按「我点过哪一行」⇒ 前台是成员会话时两行同时亮；反过来只看前台又会让
 * 「点了队长不在跑的队」什么都不亮。半个判据无论怎么组合都错，所以判据只在这里有一份。
 *
 * # 两条事实，都不是本地记账
 *
 * | 事实 | 来源 | 覆盖的情形 |
 * | --- | --- | --- |
 * | 前台会话属于某个团队 | `foregroundTeamId(refs, sessions)` | 接管了队长 / 成员的终端 |
 * | 用户点过某一行 | `workspaceStore.activeTeam`（带 projectId） | 队长不在跑，点了只开面板 |
 *
 * # 三条失效判据（都指向同一个症状：**没有行亮，却让出了高亮**）
 *
 * 1. 点过的队**已不在** `teams` 里（被删 / 关到消失）⇒ 不算：否则它自己的单元行永远让着。
 * 2. 点过的队属于**别的项目** ⇒ 不算：`activeTeam` 带项目分量就是为了让这种状态不可表达。
 * 3. 前台会话属于一个**不在清单里的**队（清单还没拉到 / 已删）⇒ 也不算，且**不回落**到
 *    点过的那一行：前台会话说了算（与 `foregroundTeamId` 的「命中的第一条 ref 说了算」
 *    同一条纪律），而那个队此刻没有行可亮。
 *
 * `teams` 是本项目（或本渲染组）的团队清单 —— 校验用它的唯一理由：**只认还在场的那一行**。
 * 于是不变量是「单元行让出高亮 ⇔ 团队行真的亮着」，而不是「这两件事各算一次碰巧对上」。
 */
export interface TeamRowFacts {
  /** 本组（通常 = 本项目）的团队清单：既是「点过的那一行还在不在」的唯一依据，也是候选集。 */
  teams: readonly TeamSummary[];
  /** 当前前台会话 refs（`useActiveSessionRefs` 的唯一派生）。 */
  refs: readonly SessionRef[];
  /** live 快照（`useLiveSessionsStore.sessions` 的稳定切片）。 */
  sessions: readonly SessionView[];
  /** 用户最后点过的那一行（`workspaceStore.activeTeam`）；`null` = 没点过团队。 */
  activeTeam: ActiveTeam | null;
}

export function currentTeamIdOf({
  teams,
  refs,
  sessions,
  activeTeam,
}: TeamRowFacts): string | null {
  const foreground = foregroundTeamId(refs, sessions);
  if (foreground !== null) {
    // 前台说了算 —— 但它得有行可亮（见文件头判据 3）。
    return teams.some((team) => team.teamId === foreground) ? foreground : null;
  }

  if (activeTeam === null) return null;
  const stillListed = teams.some(
    (team) => team.teamId === activeTeam.teamId && team.projectId === activeTeam.projectId,
  );
  return stillListed ? activeTeam.teamId : null;
}

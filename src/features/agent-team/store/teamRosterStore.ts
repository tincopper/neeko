import { create } from 'zustand';

import type { MemberStatusView } from '@/shared/types/team';
import { invokeErrorMessage } from '@/shared/utils/invokeError';

import { fetchTeamSnapshot } from '../api/teamApi';

/**
 * 侧栏团队容器行的**花名册缓存**（按队键控，展开才拉）。
 *
 * # 为什么不是 `teamStore`
 *
 * `teamStore.snapshot` 的语义是「**面板当前打开的那一个队**」。侧栏展开 A 队时若写它，
 * 面板会被切到 A（AC4）—— 用户只是想在侧栏看一眼谁在跑，不该丢掉面板里正在看的队。
 *
 * 所以这份缓存回答的问题是「我展开过的这些队，各自的花名册是什么」：
 *
 * ```text
 * teamStore.snapshot        ← 面板：我正在看哪个队（单值）
 * teamRosterStore.rosters   ← 侧栏：我展开过的一组队（按队键控）
 * ```
 *
 * 两者都来自同一个后端读接口（`team_snapshot`），但**不是同一份事实的副本**：一个当前值、
 * 一个按 id 的缓存。这也是红线 17 的判据 —— 这里存的是**后端读接口的响应**，不是
 * 「我请求过谁 / 我展开了谁」（展开态是组件本地 state）。
 *
 * # 为什么可以直接用 `team_snapshot` 而不是新增 `team_roster`
 *
 * `team_list` 回答「这台机器上有哪些队」，`team_snapshot` 回答「这一个队长什么样」。
 * 再加一条只返回成员的命令就是同一份数据的第三个读面，而载荷已经是有界的（花名册 + ≤200
 * 任务列）。代价是展开时多搬 ≤200 张任务卡片；若实测有压力，届时删这条路径换
 * `team_roster`（不是并行两条）。
 *
 * # 失效：团队脉冲 → 全量标脏（不删数据）
 *
 * 既有团队脉冲（`AGENT_TEAM_EVENT`）是本域**唯一**的失效源，订阅也仍然只有
 * `store/teamStore::ensureTeamPulseListener` 一处 `listen`。
 *
 * 作废做的是**标脏**而不是删条目：本域已有的纪律是「失败 / 刷新期间不清空上一次成功的结果」
 * （`teamStore.snapshot` / `teamListStore.list` 都写下了这条，理由是同一条 —— 闪白比旧数据
 * 更糟，而「看起来团队没了」正是最贵的一次误读）。展开中的行看到 `stale` 就重取，
 * 重取失败时成员列表仍留在屏幕上。
 *
 * # 代数守卫
 *
 * 脉冲落在请求在飞期间 ⇒ 那份响应属于上一代，**丢弃**并把它对应的条目重新标脏（否则界面会
 * 停在脉冲前的一版数据上，而没有任何东西会再去拉它）。这与 `teamStore.refresh` /
 * `teamListStore.refresh` 的守卫同一条纪律。
 */

/** 一个队的成员缓存。 */
export interface TeamRosterEntry {
  /** 花名册（`TeamSnapshot.members` 原样；成员名**只**从这里来，禁止从 `memberId` 拆）。 */
  members: MemberStatusView[];
  /** 成员数（后端口径：不含队长、含已退出 —— 与面板头同一个访问器）。 */
  memberCount: number;
  loading: boolean;
  /** 最近一次失败的可读原因（`AppError` 原文）；`null` = 没有错误。 */
  error: string | null;
  /** 被团队脉冲作废：展开中的行据此重取（成员仍是上一次成功的那份）。 */
  stale: boolean;
}

/**
 * 花名册请求的代数守卫（模块级，见文件头「代数守卫」）。
 *
 * `invalidateAll` 是唯一自增点：只有团队脉冲会让在飞的响应作废。
 */
let generation = 0;

export interface TeamRosterStoreState {
  /** `teamId → 花名册`。没有条目 = 这个队还没被展开过（不是「没有成员」）。 */
  rosters: Record<string, TeamRosterEntry>;
  /**
   * 确保某个队的花名册在缓存里（**幂等**）。
   *
   * 三种「什么都不做」：已在飞（并发 `ensure` 只发一次请求）、已有干净缓存、以及
   * 「没有别的信号」这一情形不存在（缺失 / 标脏 / 上次失败都会重取）。
   */
  ensure: (teamId: string) => Promise<void>;
  /** 团队脉冲：把所有已缓存的条目标脏（保留成员，见文件头）。 */
  invalidateAll: () => void;
}

/** 空缓存：重置与初始态共用一份引用，订阅者拿到同一个空对象。 */
const NO_ROSTERS: Record<string, TeamRosterEntry> = {};

export const useTeamRosterStore = create<TeamRosterStoreState>((set, get) => ({
  rosters: NO_ROSTERS,

  ensure: async (teamId) => {
    const entry = get().rosters[teamId];
    // 在飞：并发的 `ensure`（两次展开 / 展开 + 脉冲）只能发一次请求。
    if (entry?.loading === true) return;
    // 干净缓存：折叠再展开不重拉（AC3）。
    if (entry !== undefined && !entry.stale && entry.error === null) return;

    const mine = generation;
    // 重取期间保留上一次成功的成员（`entry` 存在只可能是标脏 / 上次失败）。
    const members = entry?.members ?? [];
    const memberCount = entry?.memberCount ?? 0;
    set((s) => ({
      rosters: {
        ...s.rosters,
        [teamId]: { members, memberCount, loading: true, error: null, stale: false },
      },
    }));

    /** 落地时发现代数变了：丢弃这份响应，但把条目交回「可重取」的状态。 */
    const superseded = (): void => {
      const current = get().rosters[teamId];
      if (current === undefined) return;
      set((s) => ({
        rosters: { ...s.rosters, [teamId]: { ...current, loading: false, stale: true } },
      }));
    };

    try {
      const snapshot = await fetchTeamSnapshot(teamId);
      if (mine !== generation) {
        superseded();
        return;
      }
      set((s) => ({
        rosters: {
          ...s.rosters,
          [teamId]: {
            members: snapshot.members,
            memberCount: snapshot.memberCount,
            loading: false,
            error: null,
            stale: false,
          },
        },
      }));
    } catch (err) {
      if (mine !== generation) {
        superseded();
        return;
      }
      // 失败**不清空**成员：上一次成功的那份仍在（见文件头「失效」）。
      set((s) => ({
        rosters: {
          ...s.rosters,
          [teamId]: {
            members,
            memberCount,
            loading: false,
            error: invokeErrorMessage(err, 'Could not load the team roster'),
            stale: false,
          },
        },
      }));
    }
  },

  invalidateAll: () => {
    generation += 1;
    const current = get().rosters;
    const next: Record<string, TeamRosterEntry> = {};
    for (const [teamId, entry] of Object.entries(current)) {
      next[teamId] = { ...entry, stale: true };
    }
    // 没有缓存时保持同一份空引用（避免每次脉冲都换一个新对象惊动订阅者）。
    set({ rosters: current === NO_ROSTERS ? NO_ROSTERS : next });
  },
}));

/**
 * 仅供测试：清空缓存（生产代码不得调用）。
 *
 * `generation` **不重置**：它是模块级单调递增的守卫，重置会让上一个用例挂起的请求与当前
 * 用例的请求撞上同一个代数，于是陈旧响应被当成最新的一份写进来（测试间的假绿）。
 */
export function __resetTeamRosterStoreForTests(): void {
  useTeamRosterStore.setState({ rosters: NO_ROSTERS });
}

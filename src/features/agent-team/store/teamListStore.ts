import { create } from 'zustand';

import type { TeamList } from '@/shared/types/team';
import { invokeErrorMessage } from '@/shared/utils/invokeError';

import { fetchTeamList } from '../api/teamApi';

/**
 * 团队清单（`team_list`）的**唯一读面**：这台机器上的团队，谁都可以读，没有第二个轮询。
 *
 * # 为什么从 `hooks/useTeamList` 搬到 store（2026-11-17）
 *
 * 清单原来是**面板局部**的 `useState`：面板挂载才拉，卸载即丢。侧栏团队行是**常驻**的
 * （每个单元下都要有），再各拉一份就是同一个资源两套轮询、两份『上次成功的结果』——
 * 一份失败时另一份还在显示旧数据，而两份都自称是「这台机器上的团队」。
 *
 * 所以读路径只有这一个所有者（与 `teamStore` 同一个纪律）：
 *
 * ```text
 * listen(AGENT_TEAM_EVENT)   ← 只有 teamStore 一处（ensureTeamPulseListener）
 *   → teamStore.applyPulse(rev)         ← 快照面水位
 *   → teamListStore.applyPulse(rev)     ← 清单面水位（本文件）
 *     → usePulseRefresh（各读面自己持引擎）→ refresh()
 * ```
 *
 * # 拉**全部**项目，按项目过滤在消费侧
 *
 * `fetchTeamList(null)`：侧栏要列的是**所有**项目下的团队，用「激活项目」顶替会把别的项目的
 * 团队凭空藏起来（而它们确实在）。面板仍只显示激活项目的团队 —— 那是**消费侧**过滤
 * （`useTeamList`），不是请求口径。
 *
 * # 必须写下来的退化（诚实优先于好看）
 *
 * 后端上界 `view::MAX_LISTED_TEAMS = 50`，且**曾经在截断之前**应用 `project_id` 过滤
 * （`list_teams_scoped(Some(projectId))`）。现在请求口径是「全部项目」，于是截断发生在
 * **跨项目之后**、过滤在**前端**：一台机器上的团队超过 50 个时，面板看到的**行数可能比
 * 以前少**（多项目均分那 50 行）。这是有界退化（`truncated` 会亮），不是回归修复对象 ——
 * 「看全部团队」的地方是团队面板，它读同一份清单。
 *
 * # 三态分离（与 `useTeamOptions` / `useTeamRoles` 同一条纪律）
 *
 * | 状态 | 含义 | 面板 |
 * | --- | --- | --- |
 * | `list === null && loading` | 还没问到 | 「正在加载…」（**不**显示空态）|
 * | `list === null && !loading` | 失败且从未成功 | 错误原文 + 重试 |
 * | `list.teams === []` | 后端确实一个队都没有 | 「还没有团队，先以队长身份开一个」|
 *
 * 加载中显示空态会让人以为「团队都没了」—— 而真相是「还没问到」。初值 `loading: true`
 * 就是这个「还没问到」：store 是 app 级的，第一个读面挂载时会立刻拉一次。
 *
 * # 失败不清空
 *
 * 重取失败保留上一次成功的清单（同 `teamStore.snapshot`）：闪空比旧数据更糟，而行上的状态
 * 徽标本来就来自后端，旧一点仍然对得上一分钟前的现实。
 *
 * # 只存读结果
 *
 * 这里**不**存「我问过哪个项目 / 我请求过谁」（红线 17）：过滤所需的项目身份来自消费侧的
 * `projectStore`，不在这里做第二份账。
 */

/**
 * 清单请求的代数守卫：并发刷新（侧栏 + 面板 + 脉冲）时，**迟到的响应不许盖掉新响应**。
 *
 * 曾经另一条路是「在飞时直接复用同一个 Promise」，但它会让一个挂死的请求**永久堵死**
 * 后续所有刷新（后端卡住一次，清单就再也不更新）。代数守卫没有这个失效面：每次都能重发，
 * 只有最新一代的落地才被写入。
 */
let generation = 0;

export interface TeamListStoreState {
  /** `null` = 还没拿到过清单（首次加载 / 失败且从未成功）。 */
  list: TeamList | null;
  loading: boolean;
  /** 最近一次失败的可读原因（`AppError` 原文）；`null` = 没有错误。 */
  error: string | null;
  /** 已应用的清单面脉冲代数（`rev <= lastRev` 一律忽略）。 */
  lastRev: number;
  /**
   * 拉一次整份清单（**全部项目**）。
   *
   * 返回 `Promise<void>` 而不是 `void` 是 [`usePulseRefresh`] 的契约要求：在飞期间又来的
   * 脉冲只能**排一个待办**，落地后再补一次；拿不到落地时刻就只能并发发起，最后一条变化会
   * 被乱序响应盖掉（虽然本 store 还有代数守卫兜底，但合并窗口是更便宜的解法）。
   */
  refresh: () => Promise<void>;
  /**
   * 应用一条清单面脉冲代数。
   *
   * @returns `true` = 新代数（读面据此重取）；`false` = 陈旧脉冲（`rev <= lastRev`）。
   *
   * 与 `teamStore.applyPulse` **同一个判据、各自一份水位**：快照面与清单面是两块数据，
   * 各有各的读面；水位共用一份的话，一块的读面会把另一块的「已应用」当成自己的。
   */
  applyPulse: (rev: number) => boolean;
}

/** 未问到的初态：`loading: true` = 「正在加载…」，不是「一个都没有」。 */
const NOT_ASKED = { list: null, loading: true, error: null, lastRev: 0 } as const;

export const useTeamListStore = create<TeamListStoreState>((set, get) => ({
  ...NOT_ASKED,

  refresh: async () => {
    const mine = ++generation;
    set({ loading: true });
    try {
      const next = await fetchTeamList(null);
      if (mine !== generation) return;
      set({ list: next, loading: false, error: null });
    } catch (err: unknown) {
      if (mine !== generation) return;
      // 不清空 list：见文件头「失败不清空」。
      set({
        loading: false,
        error: invokeErrorMessage(err, 'Could not list the teams on this machine'),
      });
    }
  },

  applyPulse: (rev) => {
    if (rev <= get().lastRev) return false;
    set({ lastRev: rev });
    return true;
  },
}));

/**
 * 仅供测试：把状态回到「未问到」（生产代码不得调用）。
 *
 * store 是 app 级的，不再随组件卸载消失 —— 于是「每个用例从干净状态开始」必须显式重置，
 * 否则上一个用例的清单（甚至一条挂死的在飞请求之后的 `loading`）会漏进下一个用例。
 *
 * **代数守卫不重置**：它是模块级单调递增的，重置会让「上一个用例挂起的请求」与「当前用例的
 * 请求」撞上同一个代数，于是那个陈旧响应会被当成最新的一份写进来（测试间的假绿）。
 */
export function __resetTeamListStoreForTests(): void {
  useTeamListStore.setState({ ...NOT_ASKED });
}

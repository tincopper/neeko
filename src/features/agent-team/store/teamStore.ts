import { create } from 'zustand';

import type { TeamSnapshot } from '@/shared/types/team';
import { invokeErrorMessage } from '@/shared/utils/invokeError';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

import { fetchTeamSnapshot, subscribeTeamPulse } from '../api/teamApi';

import { useTeamListStore } from './teamListStore';

/**
 * 团队面板状态（`snapshot` 是**唯一**渲染真相）。
 *
 * # 为什么前端不缓存「成员当前状态」
 *
 * 后端 `TeamSnapshot` 每次都由 `agent/team/view.rs` **重新推导**（租约剩余秒、取证水位线
 * 全部是派生值）。前端只要自己留一份「成员状态副本」，就得在每条脉冲上做增量迁移 ——
 * 那就是在 TS 里重建第二份状态机，两份必然漂移且漂移是静默的。因此本 store 只有：
 *
 * | 字段 | 语义 |
 * | --- | --- |
 * | `snapshot` | 上次快照的**原样**留用（重取失败时不清空：闪空比旧数据更糟）|
 * | `detail` | 点开过的那个任务的正文（**只有这里**有 body，红线 4）|
 * | `lastRev` | 已应用的脉冲代数（`rev` 去重的唯一状态）|
 *
 * # 为什么订阅是**本 store 独占**的
 *
 * 曾经每个读面（快照 / 列表 / 成员详情）各自 `listen(AGENT_TEAM_EVENT)` + 各自的合并窗口，
 * 于是「一次拉数」要做对四件事：**订阅、`rev` 去重、合并窗口、卸载闩**。四件事散在三个
 * hook 里各写一遍，其中一块漏一项时行为仍然「看起来正常」—— 失败是静默的（团队列表就漏了
 * 订阅，列表页因此永远看不见建队 / 关队 / 另一窗口的变更）。
 *
 * 现在只有一个所有者：
 *
 * ```text
 * listen(AGENT_TEAM_EVENT)  ← 只有这里
 *   → applyPulse(rev)       ← 去重（陈旧脉冲不改状态，也就不会惊动任何读面）
 *   → lastRev 变化           ← 唯一的通知通道（快照面 + 清单面各一份水位）
 *     → usePulseRefresh     ← 合并窗口 / 在飞排队 / 卸载闩（一份实现，多处共用）
 * ```
 *
 * 「通知」不用回调注册表而用 `lastRev` 这个状态本身：zustand 的订阅已经是回调分发层，
 * 再造一套 `Set<() => void>` 只是把同一件事做两遍（而且要自己管注销）。
 */

/** 快照的代数守卫：只有最新一代的响应可以写入（换队 / 并发刷新时丢弃陈旧响应）。 */
let generation = 0;

/**
 * 团队事件的**唯一**订阅（惰性建立，见 [`ensureTeamPulseListener`]）。
 *
 * 存 Promise 而不是 `UnlistenFn`：`listen()` 是跨进程往返，同一个 tick 里可能被多个读面
 * 同时要求「确保有人在听」—— 用一个 Promise 做身份，保证只会注册**一个**监听。
 */
let pulseSubscription: Promise<unknown> | null = null;

/**
 * 快照请求的代数守卫：切队 / 关闭后，迟到的快照响应**不许**把界面又拉回旧队。
 *
 * （任务详情已改为「点开才拉」的中央 tab，不再有 store 里的 detail 与其守卫。）
 */

export interface TeamStoreState {
  /** 当前盯着的团队；`null` = 面板空态（显示队长入口）。 */
  teamId: string | null;
  /** 面板唯一数据源。 */
  snapshot: TeamSnapshot | null;

  loading: boolean;
  /** 最近一次失败的可读原因（`AppError` 的原文）。 */
  error: string | null;
  /** 已应用的脉冲代数（单调递增，`rev <= lastRev` 一律忽略）。 */
  lastRev: number;
  /** 切到某个团队并拉快照（同一 id 重复调用是幂等的）。 */
  openTeam: (teamId: string) => Promise<void>;
  /** 关闭当前团队面板（回到空态）。 */
  closeTeam: () => void;
  /** 重取快照（脉冲 / 手动刷新共用）。 */
  refresh: () => Promise<void>;
  /**
   * 应用一条脉冲代数。
   *
   * @returns `true` = 这条脉冲带来了新代数（调用方据此决定要不要重取）；
   *          `false` = 陈旧脉冲（`rev <= lastRev`），**不要**重取。
   *
   * 去重是必要的：一次动作会产生多条脉冲（每个写路径一条），而一次快照覆盖全部 ——
   * 不去重就等于把「一个动作」放大成「N 次全量拉取」。
   */
  applyPulse: (rev: number) => boolean;
}

/** 空态：没有团队时面板要显示队长入口，而不是一个空任务板。 */
const EMPTY = {
  teamId: null,
  snapshot: null,
  loading: false,
  error: null,
  lastRev: 0,
} as const;

export const useTeamStore = create<TeamStoreState>((set, get) => ({
  ...EMPTY,

  openTeam: async (teamId) => {
    if (get().teamId === teamId && get().snapshot !== null) {
      // 幂等：已经在看这个团队（且已有数据）→ 不打断、不闪空。
      return;
    }
    // 换队作废在飞响应：新团队的快照绝不能被上一个团队的响应覆盖。
    generation += 1;
    set({ ...EMPTY, teamId, loading: true });
    await get().refresh();
  },

  closeTeam: () => {
    generation += 1;
    set({ ...EMPTY });
  },

  refresh: async () => {
    const teamId = get().teamId;
    if (!teamId) return;
    const mine = ++generation;
    set({ loading: true });
    try {
      const snapshot = await fetchTeamSnapshot(teamId);
      if (mine !== generation || get().teamId !== teamId) return;
      set({ snapshot, loading: false, error: null });
    } catch (err) {
      if (mine !== generation || get().teamId !== teamId) return;
      // 失败**不清空** snapshot：脉冲/瞬时故障之后闪白会让面板看起来像团队没了。
      set({ loading: false, error: invokeErrorMessage(err, 'Could not load the team snapshot') });
    }
  },

  applyPulse: (rev) => {
    if (rev <= get().lastRev) return false;
    set({ lastRev: rev });
    return true;
  },
}));

/**
 * 某个团队**已经不存在**（关闭成功 / 删除成功）之后的面板归位：正盯着它就回空态。
 *
 * # 为什么这是一条具名不变量，而不是两个 hook 各写一遍 `if`
 *
 * 「关掉的/删掉的正好是当前打开的那个队 ⇒ 清 store」是个**领域规则**，不是某个动作的实现
 * 细节：漏了它的后果与动作无关 —— 面板会继续盯一个不存在的队，下一次脉冲就去拉
 * `team_snapshot` 一个已消失的 id，界面挂在一句 `NotFound` 上（「操作成功了，界面反而坏了」）。
 *
 * 两个动作（`useTeamClose` / `useTeamDelete`）都要它，所以它必须只有一个home：写两遍时
 * 第三个人加第三个动作就会照抄其中一份，而两份里只要有一份先漂移，症状只在竞态下出现。
 *
 * **不是**「无条件清空」：关掉/删掉一个**别的**队时，用户正盯着的那个队不该被扔掉 ——
 * 那会把一次无关的清理变成视角重置。
 */
export function forgetTeamIfShowing(teamId: string): void {
  const store = useTeamStore.getState();
  if (store.teamId === teamId) store.closeTeam();
}

/**
 * 确保团队事件有一个（且仅一个）监听者。
 *
 * 幂等：多个读面同时挂载时只有第一次真的去 `listen`。由 [`usePulseRefresh`] 在挂载时调 ——
 * 不在模块加载时就订阅，因为那是 import 期的副作用（测试会拿到上一个用例的 mock，
 * 而生产里「谁在听」也就不再可追溯）。
 */
export function ensureTeamPulseListener(): void {
  if (pulseSubscription !== null) return;
  pulseSubscription = subscribeTeamPulse((rev) => {
    // 陈旧脉冲（一次动作会连发多条）不改 `lastRev`，于是没有读面被惊动 ——
    // 去重与通知是同一件事的两个面。
    useTeamStore.getState().applyPulse(rev);
    // 清单是**另一块**数据面（一个问「这台机器上有哪些队」，一个问「这个队长什么样」），
    // 所以它有自己的水位；但仍然只有**这一个** `listen`（红线 17：不建第二份订阅）。
    useTeamListStore.getState().applyPulse(rev);
  });
}

/** 仅供测试：重置模块级代数守卫（生产代码不得调用）。 */
export function __resetTeamGenerationForTests(): void {
  generation = 0;
}

/**
 * 仅供测试：忘掉当前订阅，让下一个 `usePulseRefresh` 重新 `listen`。
 *
 * 生产代码不得调用（它就是「没人听了」这个状态的人造版本）。测试需要它是因为
 * `listen` 在全局 mock 里是**按用例重置**的：保留旧订阅会让后续用例的脉冲落到上一份 mock 上。
 */
export function __resetTeamPulseForTests(): void {
  const pending = pulseSubscription;
  pulseSubscription = null;
  if (pending === null) return;
  void pending.then((unlisten) => {
    if (typeof unlisten === 'function') safeUnlisten(unlisten as () => void)();
  });
}

import { create } from 'zustand';

import type { TaskDetail, TeamSnapshot } from '@/shared/types/team';

import { fetchTaskDetail, fetchTeamSnapshot } from '../api/teamApi';
import { messageOf } from '../utils/errors';

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
 * # `rev` 去重为什么在 store 而不在 hook
 *
 * 「要不要重取」是状态判断（与 `lastRev` 比较），「什么时候重取」是调度（合并窗口）。
 * 前者放这里才能被多个订阅点共享一份水位线；后者属 hook（见 `hooks/useTeamPanel`）。
 */

/** 快照的代数守卫：只有最新一代的响应可以写入（换队 / 并发刷新时丢弃陈旧响应）。 */
let generation = 0;

/**
 * 详情请求的代数守卫：抽屉可能已经被关掉或换了一张卡片，迟到的响应**不许**把抽屉又打开。
 *
 * 与快照守卫分开的原因：两者生命周期不同 —— 快照随团队变，详情随一次点击变。
 */
let detailRequest = 0;

export interface TeamStoreState {
  /** 当前盯着的团队；`null` = 面板空态（显示队长入口）。 */
  teamId: string | null;
  /** 面板唯一数据源。 */
  snapshot: TeamSnapshot | null;
  /** 点开的任务详情（含正文）；`null` = 抽屉关闭。 */
  detail: TaskDetail | null;
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
  /** 点开任务详情（**只有这里**会走 `team_task_detail`）。 */
  openTaskDetail: (taskId: string) => Promise<void>;
  /** 关闭详情抽屉（清掉正文，不留残影）。 */
  closeTaskDetail: () => void;
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
  detail: null,
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
    detailRequest += 1;
    set({ ...EMPTY, teamId, loading: true });
    await get().refresh();
  },

  closeTeam: () => {
    generation += 1;
    detailRequest += 1;
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
      set({ loading: false, error: messageOf(err, 'Could not load the team snapshot') });
    }
  },

  openTaskDetail: async (taskId) => {
    const mine = ++detailRequest;
    try {
      const detail = await fetchTaskDetail(taskId);
      // 期间可能已经关闭了抽屉 / 换了团队 / 点了另一张卡片：不在这些情形下把正文塞回去。
      if (mine !== detailRequest || get().teamId === null) return;
      set({ detail });
    } catch (err) {
      if (mine !== detailRequest) return;
      set({ error: messageOf(err, `Could not load task ${taskId}`) });
    }
  },

  closeTaskDetail: () => {
    detailRequest += 1;
    set({ detail: null });
  },

  applyPulse: (rev) => {
    if (rev <= get().lastRev) return false;
    set({ lastRev: rev });
    return true;
  },
}));

/** 仅供测试：重置模块级代数守卫（生产代码不得调用）。 */
export function __resetTeamGenerationForTests(): void {
  generation = 0;
}

import { useEffect } from 'react';

import type { TaskDetail, TeamSnapshot } from '@/shared/types/team';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

import { subscribeTeamPulse } from '../api/teamApi';
import { useTeamStore } from '../store/teamStore';

/**
 * 脉冲合并窗口（毫秒）。
 *
 * 一个用户可见的动作会产生**多条**脉冲（后端每个写路径都发一条：`task_claim` 一条、
 * `task_update` 两条…）。若每条脉冲都 `invoke` 一次快照，一次「派活」就会把整块板拉三遍，
 * 而且三份响应会乱序落地（后到的旧快照把新快照盖回去）。窗口内只排一次刷新即可：
 * 快照是全量自愈的，合并**永远不会丢状态**（这是「脉冲不是增量」的直接推论）。
 */
export const PULSE_COALESCE_MS = 100;

/** 面板要渲染的全部东西（**全部来自 store，组件不持有副本**）。 */
export interface TeamPanelState {
  teamId: string | null;
  snapshot: TeamSnapshot | null;
  detail: TaskDetail | null;
  loading: boolean;
  error: string | null;
}

/**
 * 团队面板的数据装配：首拉 + 脉冲订阅 + 合并刷新。
 *
 * 三条行为，每条都对应一种现场故障：
 *
 * 1. **挂载 / 换队立刻拉一次** —— 不拉就只剩一条空板，而脉冲只在「写」之后才来，
 *    所以「打开面板什么都看不到，直到别人动一下」是必然的。
 * 2. **脉冲合并** —— 见 [`PULSE_COALESCE_MS`]。合并窗口内到多个脉冲只排一次刷新；
 *    在飞期间又到的脉冲**记一个待办**，落地后再补一次（否则刷新期间的最后一次变化
 *    会被永久吞掉，面板停在旧值）。
 * 3. **卸载即退订** —— 面板被切走会卸载（这里刻意不依赖「webview 还活着」），
 *    不退订就会在挂载/卸载多次之后积累 N 个监听，每个都触发一次全量拉取。
 *
 * 去重（`rev <= lastRev`）不在这里：它是状态判断，落在 `teamStore.applyPulse`。
 */
export function useTeamPanel(): TeamPanelState {
  const teamId = useTeamStore((s) => s.teamId);
  const snapshot = useTeamStore((s) => s.snapshot);
  const detail = useTeamStore((s) => s.detail);
  const loading = useTeamStore((s) => s.loading);
  const error = useTeamStore((s) => s.error);

  // ① 首拉 / 换队重拉。
  useEffect(() => {
    if (!teamId) return;
    void useTeamStore.getState().refresh();
  }, [teamId]);

  // ② + ③ 脉冲订阅与合并刷新。
  useEffect(() => {
    if (!teamId) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    /** 在飞期间又来了新脉冲 —— 落地后补一次（合并，但**不能**丢最后一条）。 */
    let queued = false;
    /**
     * 卸载闩。
     *
     * `unlisten` 是一次跨进程往返：注销请求发出后，已经上路的事件仍可能落达（Tauri 侧先派发
     * 后处理注销）。没有这个闩，卸载之后的脉冲依旧会排一次全量拉取 —— 面板明明已经不在了。
     */
    let cancelled = false;

    const run = async (): Promise<void> => {
      inFlight = true;
      try {
        await useTeamStore.getState().refresh();
      } finally {
        inFlight = false;
        if (queued) {
          queued = false;
          // 卸载后不得再排任何刷新（否则面板没了，invoke 还在跑）。
          if (!cancelled) schedule();
        }
      }
    };

    const schedule = (): void => {
      if (cancelled) return;
      if (timer !== null) return; // 已在窗口内 → 本批脉冲被合并
      timer = setTimeout(() => {
        timer = null;
        if (inFlight) {
          queued = true;
          return;
        }
        void run();
      }, PULSE_COALESCE_MS);
    };

    const unlistenPromise = subscribeTeamPulse((rev) => {
      if (cancelled) return;
      // 陈旧脉冲（一次动作会连发多条）→ 不排刷新。
      if (!useTeamStore.getState().applyPulse(rev)) return;
      schedule();
    });

    return () => {
      cancelled = true;
      queued = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      // `safeUnlisten` 吸收「listen 响应早于事件表填充」的注销竞态（见其模块注释）。
      void unlistenPromise.then((unlisten) => safeUnlisten(unlisten)());
    };
  }, [teamId]);

  return { teamId, snapshot, detail, loading, error };
}

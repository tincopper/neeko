import { useEffect } from 'react';

import type { TaskDetail, TeamSnapshot } from '@/shared/types/team';

import { useTeamStore } from '../store/teamStore';

import { usePulseRefresh } from './usePulseRefresh';

/**
 * 面板要渲染的全部东西（**全部来自 store，组件不持有副本**）。
 */
export interface TeamPanelState {
  teamId: string | null;
  snapshot: TeamSnapshot | null;
  detail: TaskDetail | null;
  loading: boolean;
  error: string | null;
}

/**
 * 团队面板的数据装配：首拉 + 脉冲驱动的合并刷新。
 *
 * 两条行为，每条都对应一种现场故障：
 *
 * 1. **挂载 / 换队立刻拉一次** —— 不拉就只剩一条空板，而脉冲只在「写」之后才来，
 *    所以「打开面板什么都看不到，直到别人动一下」是必然的。
 * 2. **脉冲驱动的重取** —— 交给 [`usePulseRefresh`]：全局订阅由 `teamStore` 独占，
 *    去重在 `applyPulse`，合并窗口 / 在飞排队 / 卸载闩在这个共享 hook 里只有一份实现。
 *    本 hook 不再自己 `listen`，也不再自己排时间窗（曾经三处各写一遍，列表那处漏了订阅，
 *    于是「建了队、回到列表还是建队前的清单」）。
 *
 * 没有打开的队（`teamId === null`）时关掉脉冲刷新：此刻面板显示的是列表，快照没有消费者。
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

  // ② 脉冲 → 合并刷新（订阅/去重都不在这里，见本文件头）。
  usePulseRefresh(useTeamStore.getState().refresh, { enabled: teamId !== null });

  return { teamId, snapshot, detail, loading, error };
}

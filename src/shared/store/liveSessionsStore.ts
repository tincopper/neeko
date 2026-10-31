import { create } from 'zustand';

import type { LiveSessionsSnapshot, SessionView } from '@/shared/types/liveSessions';

/**
 * live-sessions 快照的**唯一**前端副本。
 *
 * 三条不变式：
 * 1. **只做 hydrate / apply**：不派生、不排序、不分组 —— 派生在
 *    `@/shared/selectors/liveSessionSelectors`（纯函数），store 里存派生值会造出第二份真相。
 * 2. **丢弃乱序回包**：`apply` 只接受版本不小于当前的回包。快照由事件 + 长轮询两条通道
 *    触发，二者交叉时后到的旧快照会把侧栏打回上一状态且没有任何报错。
 * 3. **只在后端有变更时被写入**：写入方是 `useLiveSessionsBridge`，视图层无写权限
 *    （与 R1.2「状态只能经信号改变」同一条规则的前端侧）。
 */
interface LiveSessionsStoreState {
  /** 当前快照对应的注册表版本（长轮询的比较基准）。 */
  version: number;
  /** 后端注册表快照（后端已按单元 / 开始时间排序，前端不再重排）。 */
  sessions: SessionView[];
  /** 最后一次成功 hydrate 的时刻（`Date.now()`）；`null` = 从未 hydrate。 */
  hydratedAt: number | null;
  /** 应用一份快照；版本更旧的直接丢弃（返回是否真的应用了）。 */
  apply: (snapshot: LiveSessionsSnapshot) => boolean;
}

export const useLiveSessionsStore = create<LiveSessionsStoreState>((set, get) => ({
  version: 0,
  sessions: [],
  hydratedAt: null,

  apply: (snapshot) => {
    if (snapshot.version < get().version) return false;
    set({ version: snapshot.version, sessions: snapshot.sessions, hydratedAt: Date.now() });
    return true;
  },
}));

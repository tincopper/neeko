import { useMemo } from 'react';

import { sessionsByUnit } from '@/shared/selectors/liveSessionSelectors';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import type { SessionView } from '@/shared/types/liveSessions';

/**
 * 按单元分组的会话表（`workspaceKey → 会话列表`）。
 *
 * 侧栏每个项目行 / worktree 行 / 会话子列表都要「本单元的会话」：一次性 O(n) 分组供
 * 所有行共用，避免每行各扫一遍全表（`sessions.filter(...)` 在 N 个单元 × M 条会话下
 * 是 N×M）。分组口径只有 `sessionsByUnit` 一处实现。
 *
 * `useMemo` 的依赖是**快照数组本身**：store 的 `apply` 只在版本前进时替换它，于是同一份
 * 快照下所有订阅者拿到同一个 `Map`，行组件的 memo 才有效。
 */
export function useSessionsByUnit(): Map<string, SessionView[]> {
  const sessions = useLiveSessionsStore((s) => s.sessions);
  return useMemo(() => sessionsByUnit(sessions), [sessions]);
}

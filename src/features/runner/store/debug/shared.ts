import { useNotificationStore } from '@/shared/store/notificationStore';

import type { StopLocation } from '../../stackFrames';
import type { DapSessionInfo } from '../../types';

import type { DebugStore } from './types';

/**
 * 跨 slice 共享的**叶子原语**：不含 state、不 import 任何 slice。
 * 依赖方向：`types.ts` → 本文件 → slice 文件（单向，无环）。
 */

/** Stable empty list — never return a fresh `[]` from selectors (avoids re-render loops). */
export const EMPTY_BP_LINES: readonly number[] = Object.freeze([]);

/**
 * Clear lazy variable-expansion state. DAP `variablesReference` values are only
 * valid for the current paused context — stale caches would silently show data
 * from a previous stop (Delve may even reuse references), so every context
 * switch (stopped → new stop / continued / frame switch / session end) resets.
 */
export const CLEAR_EXPANSION = {
  childrenByRef: {},
  expandedRefs: {},
  loadingRefs: {},
  varErrors: {},
} as const;

export function notifyError(message: string) {
  useNotificationStore.getState().addNotification({
    type: 'error',
    title: 'Debug',
    message,
  });
}

/**
 * 栈 / 变量刷新失败：**只记日志，绝不弹 toast**。
 *
 * 策略理由：Delve 的 stack race（`Dummy thread`、goroutine 抖动）是**瞬态**，且
 * `refreshStackAndVars` 已内置一次 150ms 重试；最终仍失败时错误会进 Debug Console（`pushConsole`），
 * 用户需要时看得到 —— 弹 toast 只会造成零信息量的打扰。
 *
 * 注：此前本函数有一段 `if (msg.includes('stackTrace') || msg.includes('goroutine'))` 分支，
 * 但两个分支体完全相同（都是 `console.warn`），条件对行为毫无影响（Neeko Check F14）。
 * 这里收敛为单一实现，把原本想表达的「只记日志」策略写成文档 + 回归用例。
 */
export function logDebugStackError(msg: string) {
  console.warn('[debug]', msg);
}

let consoleSeq = 0;

/** 控制台行 id 单调递增（同一 store 实例内唯一）。 */
export function nextConsoleSeq(): string {
  return `c-${++consoleSeq}`;
}

export function isLiveSession(session: DapSessionInfo | null): boolean {
  return !!session?.sessionId && session.status !== 'terminated' && session.status !== 'ended';
}

/**
 * 停点位置状态对：位置 + **严格单调**的位置变化序号。
 *
 * `locationSeq` 不是可派生冗余：「位置值相同」≠「事件相同」——同一断点在循环里连续命中时
 * 各字段逐字相等，而编辑器侧必须能区分「又发生了一次停点」（新事件要重新跟随），
 * 因此事件键只能是序号。
 */
export interface StopLocationState {
  location: StopLocation | null;
  locationSeq: number;
}

/**
 * 位置变更：写入新位置（`null` = 清空）并把序号 +1。
 *
 * 所有写位置的路径（停点 / 切帧 / 清空）都经此函数，使「位置 + 序号」永远成对更新 ——
 * 编辑器侧只依赖序号，不会漏事件也不会重复响应。
 */
export function withStopLocation(
  current: StopLocationState,
  next: StopLocation | null,
): StopLocationState {
  return { location: next, locationSeq: current.locationSeq + 1 };
}

/**
 * Clear stack / vars / highlight when a session ends (idempotent).
 *
 * `locationState` 传当前状态（`get()`）：清空也是一次位置事件，序号必须继续 +1，
 * 否则结束后残留的序号会让编辑器把「清空」误判成同一次事件而不释放光标。
 */
export function endedSessionPatch(
  session: DapSessionInfo | null,
  locationState: StopLocationState,
  statusMessage = 'Session terminated',
): Partial<DebugStore> {
  return {
    session: session
      ? {
          ...session,
          status: 'terminated',
          statusMessage: session.statusMessage ?? statusMessage,
        }
      : null,
    frames: [],
    variables: [],
    ...CLEAR_EXPANSION,
    ...withStopLocation(locationState, null),
    selectedFrameId: null,
    generation: null,
  };
}

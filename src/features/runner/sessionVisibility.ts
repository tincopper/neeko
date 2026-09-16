/**
 * 「调试会话对某个项目可见」的**唯一判定**（issue #14）。
 *
 * 全局单会话（`useDebugStore.session`）带 `projectId`：切换项目后旧会话仍留在 store 里
 * （其 DAP 事件继续流入），若 UI 直接读全局 session 就会出现「选 A 项目却显示 B 项目的输出」。
 * 所以任何消费会话的地方都要过这道门。
 *
 * **为什么单独成模块**：这条门控是修 #14 得来的**不变式**，此前在三处各写一遍
 * （`useVisibleDebugSession` / `useStopLocation` / `useEditorViewSnapshot`）——
 * 漏一处就是 #14 复现。判定只允许有一个实现，散落即回到「同一规则多处解释」。
 *
 * 纯函数、零依赖：不 import React / store，故可被 selector、hook 与快照恢复共用。
 */
import type { DapSessionInfo } from './types';

/** 会话是否属于该（激活）项目 —— 任一侧缺失即不可见。 */
export function isSessionVisibleFor(
  session: DapSessionInfo | null,
  projectId: string | null,
): boolean {
  return !!session && !!projectId && session.projectId === projectId;
}

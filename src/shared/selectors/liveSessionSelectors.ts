/**
 * live-sessions 快照的**派生层**（纯函数，无 React / store 依赖）。
 *
 * 分层约定（`.trellis/spec/frontend/state-management.md`）：store 只存不派生，
 * 派生一律进 selector。三个投影（tab 标题 / 单元角标 / 侧栏会话列表）都从这里取，
 * 于是「同一份快照」这件事在代码里也只有一份实现。
 */

import type { SessionKind, SessionState, SessionView } from '@/shared/types/liveSessions';
import type { Tab } from '@/shared/types/tab';

/** 稳定的空数组：无会话的单元每帧重新 `[]` 会让 memo 失效。 */
export const NO_SESSIONS: readonly SessionView[] = [];

/**
 * 状态优先级：**多会话单元里最需要注意的那一个**。
 *
 * `awaitingApproval > running > failed > ready > stopped` —— 顺序不是审美：
 * 等用户点一下的会话最该被看见，其次是还在动的，最后才是已终止的。
 *
 * 这是**唯一**的状态排序判据（后端刻意不给 `SessionState` 派生 `Ord`：状态之间没有
 * 大小关系，只有这条视图优先级）。
 */
const STATE_RANK: Record<SessionState, number> = {
  awaitingApproval: 4,
  running: 3,
  failed: 2,
  ready: 1,
  stopped: 0,
};

/** 会话身份的最小形状：只要有 `kind` + `sessionId` 就能判定「是不是同一条」。 */
export type SessionIdentity = Pick<SessionView, 'kind' | 'sessionId'>;

/**
 * 两条会话是不是同一条：`kind` 与 `sessionId` **必须同时**相等。
 *
 * 两个字段各自配对 kind（不许混用）：会话 id 由后端铸造，chat 与 terminal 的 id 空间
 * 互不相干，但「一个 id 字符串同时命中两条记录」这种事故一旦发生就只表现为
 * 「点错 tab / 标题串线 / 高亮错行」，很难定位。这是「同一会话」的**唯一**判据，
 * 禁止调用侧自比裸 id。
 */
export function isSameSession(
  a: SessionIdentity | null | undefined,
  b: SessionIdentity | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.kind === b.kind && a.sessionId === b.sessionId;
}

/**
 * 按单元分组（`workspaceKey → 会话列表`）。
 *
 * 单元归属只做 `workspaceKey` **相等比较**：key 是后端铸造的唯一地址表示，
 * 在这里拼分隔符或比路径前缀就是第二套身份判据（红线 12）。一次 O(n) 分组供所有
 * 行共用（`useSessionsByUnit`），不按行重扫全表。
 *
 * 返回 `Map` 而不是普通对象：key 含 NUL 分隔符（`WorkspaceSession.key`），
 * 用对象属性会在 `__proto__` 之类的键上产生语义歧义，且丢失插入顺序保证。
 */
export function sessionsByUnit(sessions: readonly SessionView[]): Map<string, SessionView[]> {
  const byUnit = new Map<string, SessionView[]>();
  for (const session of sessions) {
    const list = byUnit.get(session.workspaceKey);
    if (list) list.push(session);
    else byUnit.set(session.workspaceKey, [session]);
  }
  return byUnit;
}

/** 单元角标状态：多会话取最高优先级；**空列表返回 `null`**（无会话不画点）。 */
export function dominantState(sessions: readonly SessionView[]): SessionState | null {
  let best: SessionState | null = null;
  for (const session of sessions) {
    if (best === null || STATE_RANK[session.state] > STATE_RANK[best]) best = session.state;
  }
  return best;
}

/**
 * tab 的会话身份：chat 用 `data.sessionId`，terminal 用 `data.ptySessionId`，其余 kind 没有。
 */
function tabSessionKey(tab: Tab): { kind: SessionKind; sessionId: string } | null {
  if (tab.data.kind === 'agent-chat') {
    return tab.data.sessionId ? { kind: 'chat', sessionId: tab.data.sessionId } : null;
  }
  if (tab.data.kind === 'terminal') {
    return tab.data.ptySessionId ? { kind: 'terminal', sessionId: tab.data.ptySessionId } : null;
  }
  return null;
}

/** tab → 它对应的 live session（未注册 / 尚未创建 PTY 时为 `null`）。 */
export function tabSession(
  tab: Tab | null | undefined,
  sessions: readonly SessionView[],
): SessionView | null {
  if (!tab) return null;
  const key = tabSessionKey(tab);
  if (!key) return null;
  return sessions.find((session) => isSameSession(session, key)) ?? null;
}

/** [`tabSession`] 的逆：会话 → 承载它的 tab（侧栏点会话行时激活它）。 */
export function sessionTab(session: SessionView, tabs: readonly Tab[]): Tab | null {
  return (
    tabs.find((tab) => {
      const key = tabSessionKey(tab);
      return key !== null && isSameSession(session, key);
    }) ?? null
  );
}

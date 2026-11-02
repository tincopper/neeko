import { sessionTab } from '@/shared/selectors/liveSessionSelectors';
import type { SessionView } from '@/shared/types/liveSessions';
import type { Tab } from '@/shared/types/tab';

/**
 * 点击侧栏会话行之后该做什么。
 *
 * - `activate`：tab 还在、映射键命中 —— 正常情况（绝大多数点击）。
 * - `bind`：tab 还在，但它的 `ptySessionId` 没写成功，于是映射键找不到它。
 *   **唯一候选**时把会话 id 补写回去，顺带修好这条存量 tab。
 * - `recreate`：没有任何可用 tab —— 按会话重建（「点击恢复」的兜底）。
 *
 * # 为什么需要 `bind` 而不是一律 `recreate`
 *
 * `ptySessionId` 由 PTY 创建成功后的异步回调写入（`TerminalView.handleSessionCreated`），
 * 那条路径在拿不到 tab 身份时是**静默丢弃**的。一旦丢了，侧栏照常列出这条会话
 * （分组只按 `workspaceKey`），但点击找不到 tab —— 表现为「点了没反应」。
 * 此时再建一个 tab 会留下一条点不动的孤儿终端，所以先尝试认领它。
 *
 * # 为什么只在唯一命中时 bind
 *
 * 多个候选说明我们无从判断哪一个才是这条会话；猜错会把一条会话的身份写到别人的 tab 上
 * （那个 tab 之后再也点不开自己）。宁可重建。
 */
export type SessionActivationPlan =
  | { kind: 'activate'; tabId: string }
  | { kind: 'bind'; tabId: string }
  | { kind: 'recreate' };

export function planSessionActivation(args: {
  session: SessionView;
  tabs: readonly Tab[];
}): SessionActivationPlan {
  const matched = sessionTab(args.session, args.tabs);
  if (matched) {
    return { kind: 'activate', tabId: matched.id };
  }
  const orphans = args.tabs.filter((tab) => isOrphanCandidate(tab, args.session));
  if (orphans.length === 1) {
    return { kind: 'bind', tabId: orphans[0].id };
  }
  return { kind: 'recreate' };
}

/**
 * 这条 tab 是不是「本该承载该会话、但映射键丢了」的那条。
 *
 * 只认 terminal：chat 的 `sessionId` 与 terminal 的 `ptySessionId` 写入时机不同 ——
 * 空 chat tab 是用户主动打开的正常形态（还没发过消息），把它认领给一条历史会话是
 * 真正的身份串线。terminal 的空键则只可能来自写入被丢弃。
 */
function isOrphanCandidate(tab: Tab, session: SessionView): boolean {
  if (session.kind !== 'terminal' || tab.data.kind !== 'terminal') {
    return false;
  }
  return !tab.data.ptySessionId && tab.data.agentId === session.agentId;
}

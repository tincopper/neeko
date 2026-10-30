import type { Tab } from '@/shared/types';

/** 判定「使用中」所需的最小会话身份（`ConversationMeta` 的子集）。 */
export interface ConversationIdentity {
  id: string;
  nativeSessionId: string;
}

/**
 * 这条会话是否正被一个**活的 Agent Chat 会话**占用（删除必须阻断）。
 *
 * 判据只有一条：agent-chat tab 绑定了同一个原生会话 id。那时可能有一个 agent 进程
 * 正握着那个会话文件在写，删掉它 = 让进程继续往已经不存在的文件里写（会话内容永久丢失）。
 *
 * # 为什么不把「会话查看器 tab」也算作使用中
 *
 * 查看器只是**只读渲染**，不持有任何锁；而且用户在面板里点开一行才看得见它，于是
 * 「点开 → 删除」会 100% 被判成使用中 —— 那等于把这个功能做废（2026-10-30 实测：
 * pi 会话删除被这条误判挡住）。删除成功后关掉那些查看器 tab 即可（见
 * [`conversationViewerTabRefs`]）。
 *
 * 按 id 而不是标题：标题可重复、可被用户改（`userTitle`），拿它判等会误阻断无关会话，
 * 也会漏掉同名会话（真的删掉正在跑的那一条）。
 */
export function isConversationLiveInChat(
  tabs: readonly Tab[],
  meta: ConversationIdentity,
): boolean {
  return tabs.some((tab) => {
    const { data } = tab;
    if (data.kind !== 'agent-chat') return false;
    if (data.resumeConversationId && data.resumeConversationId === meta.id) return true;
    if (data.resumeNativeSessionId && data.resumeNativeSessionId === meta.nativeSessionId) {
      return true;
    }
    if (data.sessionId && data.sessionId === meta.nativeSessionId) return true;
    return false;
  });
}

/** 一个 tab 的寻址：`closeTab` 需要「空间键 + tabId」。 */
export interface TabRef {
  spaceKey: string;
  tabId: string;
}

/**
 * 绑定这条会话的**活 Agent Chat tab**（删除前要给用户一句提醒，删除成功后关掉）。
 *
 * 与 [`isConversationLiveInChat`] 同一判据，只是返回可关闭的地址：
 * 关掉它 = 释放那个 agent 会话（新进程会在 `Drop` 时被回收）。
 */
export function conversationLiveChatTabRefs(
  tabsBySpace: Record<string, { tabs: Tab[] } | undefined>,
  meta: ConversationIdentity,
): TabRef[] {
  const refs: TabRef[] = [];
  for (const [spaceKey, space] of Object.entries(tabsBySpace)) {
    for (const tab of space?.tabs ?? []) {
      const { data } = tab;
      if (data.kind !== 'agent-chat') continue;
      const hit =
        (data.resumeConversationId && data.resumeConversationId === meta.id) ||
        (data.resumeNativeSessionId && data.resumeNativeSessionId === meta.nativeSessionId) ||
        (data.sessionId && data.sessionId === meta.nativeSessionId);
      if (hit) refs.push({ spaceKey, tabId: tab.id });
    }
  }
  return refs;
}

/**
 * 指向这条会话的**只读查看器** tab（删除成功后要关掉，否则留下一个打不开的面板）。
 *
 * 返回 `spaceKey`：`editorStore.tabs` 按 tab 空间分键，同一会话可能在别的 workspace /
 * worktree 里也开着 —— 只关当前空间会漏。
 */
export function conversationViewerTabRefs(
  tabsBySpace: Record<string, { tabs: Tab[] } | undefined>,
  meta: ConversationIdentity,
): TabRef[] {
  const refs: TabRef[] = [];
  for (const [spaceKey, space] of Object.entries(tabsBySpace)) {
    for (const tab of space?.tabs ?? []) {
      const { data } = tab;
      if (data.kind === 'conversation' && data.conversationId === meta.id) {
        refs.push({ spaceKey, tabId: tab.id });
      }
    }
  }
  return refs;
}

/**
 * 把 `editorStore.tabs`（按 tab 空间分键）展平成单一列表。
 *
 * 为什么要跨所有空间找：同一会话可能在另一个 workspace / worktree 的 tab 里开着。
 */
export function flattenTabSpaces(tabsBySpace: Record<string, { tabs: Tab[] } | undefined>): Tab[] {
  const flat: Tab[] = [];
  for (const space of Object.values(tabsBySpace)) {
    if (!space) continue;
    flat.push(...space.tabs);
  }
  return flat;
}

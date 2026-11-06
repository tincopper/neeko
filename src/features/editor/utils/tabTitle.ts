import { isListedSession, isNamedSession } from '@/shared/selectors/liveSessionSelectors';
import type { SessionView } from '@/shared/types/liveSessions';
import type { TabLike } from '@/shared/types/tab';

/**
 * tab 标题的**派生**规则：会话有名字时用注册表标题，否则用 tab 自带标题。
 *
 * ## 为什么不写回 tab store
 *
 * 标题会**单调升级**（`placeholder → prompt → native → user`）。写回 store 就多出一份
 * 「上一轮派生的结果」，任何一次升级都要有人负责再把 tab 改一遍 —— 漏一次就是「标题
 * 停在创建时」。渲染期派生保证只有一份真相（注册表），tab 的 `title` 只剩两个职责：
 * 创建期占位、用户改名。
 *
 * ## 为什么是 `isNamedSession` 而不是 `isListedSession`
 *
 * 「侧栏列不列它」与「tab 能不能用它当标题」是**两条**判据（第 35 轮修正）：
 * 侧栏只要求「用户用过」（`isListedSession`），而无 hook 的终端会话可能永远没有名字；
 * tab 标题不能是空串，所以必须额外要求**有名字**。两个条件在这里同时成立才回落到注册表。 */
export function resolveTabTitle(tab: TabLike, session?: SessionView | null): string {
  // 两条都成立才用注册表标题：用户确实用过（否则 tab 用创建期标题）+ 它已有名字。
  if (!session || !isListedSession(session) || !isNamedSession(session)) return tab.title;
  return session.title;
}

import { isListedSession } from '@/shared/selectors/liveSessionSelectors';
import type { SessionView } from '@/shared/types/liveSessions';
import type { TabLike } from '@/shared/types/tab';

/**
 * tab 标题的**派生**规则：会话已在侧栏可见时用注册表标题，否则用 tab 自带标题。
 *
 * ## 为什么不写回 tab store
 *
 * 标题会**单调升级**（`placeholder → prompt → native → user`）。写回 store 就多出一份
 * 「上一轮派生的结果」，任何一次升级都要有人负责再把 tab 改一遍 —— 漏一次就是「标题
 * 停在创建时」。渲染期派生保证只有一份真相（注册表），tab 的 `title` 只剩两个职责：
 * 创建期占位、用户改名。
 *
 * ## 为什么复用 `isListedSession` 而不是自己判两遍
 *
 * 「什么时候用注册表标题」与「什么时候把会话列进侧栏」是**同一条**判据
 * （`hasUserInput && 有名字`）。这里若自己写 `hasUserInput` + 非空检查，就有了第二份
 * 实现 —— 而两份判据迟早会漂移（曾经就有：tab 用注册表标题、侧栏却不列它）。
 */
export function resolveTabTitle(tab: TabLike, session?: SessionView | null): string {
  // `isListedSession` = 用户已经在这个会话里发出过输入、且它已经有名字 ——
  // 正是标题成立的两个条件。在那之前 tab 显示自己的 `title`（agent 名 / `Terminal N`）。
  if (!session || !isListedSession(session)) return tab.title;
  return session.title;
}

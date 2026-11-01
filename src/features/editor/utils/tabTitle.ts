import type { SessionView } from '@/shared/types/liveSessions';
import type { TabLike } from '@/shared/types/tab';

/**
 * tab 标题的**派生**规则：会话已可见（`hasUserInput`）时用注册表标题，否则用 tab 自带标题。
 *
 * ## 为什么不写回 tab store
 *
 * 标题会**单调升级**（`placeholder → prompt → native → user`）。写回 store 就多出一份
 * 「上一轮派生的结果」，任何一次升级都要有人负责再把 tab 改一遍 —— 漏一次就是「标题
 * 停在创建时」。渲染期派生保证只有一份真相（注册表），tab 的 `title` 只剩两个职责：
 * 创建期占位、用户改名。
 *
 * 空标题会退回 tab 的标题：注册表里理论上不会出现空标题（`title::pick` 保证占位非空），
 * 但一份空的 `title` 在 tab 栏上就是一条不可辨认的空白，兜底成本是零。
 */
export function resolveTabTitle(tab: TabLike, session?: SessionView | null): string {
  // `hasUserInput` = 用户已经在这个会话里发出过输入（= 侧栏列出它的时刻，也是标题成立的时刻）。
  // 在那之前（只打开了 tab）标题还是占位，tab 显示自己的 `title`（agent 名 / `Terminal N`）。
  if (!session?.hasUserInput) return tab.title;
  const derived = session.title.trim();
  if (!derived) return tab.title;
  return session.title;
}

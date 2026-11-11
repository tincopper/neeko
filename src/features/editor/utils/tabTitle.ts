import type { SessionView } from '@/shared/types/liveSessions';
import type { TabLike } from '@/shared/types/tab';

/**
 * tab 标题的**派生**规则：会话被用过之后用注册表标题，否则用 tab 自带标题。
 *
 * ## 为什么不写回 tab store
 *
 * 标题会**单调升级**（`placeholder → prompt → native → user`）。写回 store 就多出一份
 * 「上一轮派生的结果」，任何一次升级都要有人负责再把 tab 改一遍 —— 漏一次就是「标题
 * 停在创建时」。渲染期派生保证只有一份真相（注册表），tab 的 `title` 只剩两个职责：
 * 创建期占位、用户改名。
 *
 * ## 为什么直接读 `hasUserInput` 而不是 `isListedSession`
 *
 * 「侧栏列不列它」与「tab 能不能用它当标题」是**两条**判据：chat 会话要等首轮跑完才进
 * 侧栏，但 tab 从用户发出第一条消息起就应该显示会话标题 —— 拿侧栏的可见性当 tab 标题的
 * 门槛，会让 chat 在整轮运行期间一直停在 `Agent Chat` 这个占位名上。
 *
 * 不再需要「有没有名字」的二次判断：wire 上的 `title` 永远非空（无真标题时是后端合成的
 * 身份标签，见 `title::placeholder_label`）。 */
export function resolveTabTitle(tab: TabLike, session?: SessionView | null): string {
  if (!session || !session.hasUserInput) return tab.title;
  return session.title;
}

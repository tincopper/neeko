/**
 * 每项目浏览器历史栈(纯函数,无 I/O)。
 *
 * 由 `browser://url-changed` 事件流驱动:新导航 push(截断前进分支),
 * 后退/前进命中已有条目时移动指针。`canGoBack`/`canGoForward` 由此派生,
 * 驱动工具栏按钮的可用状态。
 */

export interface HistoryStack {
  entries: string[];
  index: number;
}

/** 空栈:index = -1(无当前页)。 */
export function createHistoryStack(initialUrl?: string): HistoryStack {
  const entries = initialUrl ? [initialUrl] : [];
  return { entries, index: entries.length - 1 };
}

/**
 * 记录一次导航。
 * - 空栈 → 以 url 为唯一条目。
 * - url 与当前条目相同(同页刷新/重定向)→ 不变。
 * - url 已存在于历史(后退/前进命中)→ 移动指针到该条目。
 * - 否则为全新导航 → 截断当前指针之后的前进分支,追加 url。
 */
export function recordNavigation(stack: HistoryStack, url: string): HistoryStack {
  if (!stack) return createHistoryStack(url);
  if (stack.entries.length === 0) return { entries: [url], index: 0 };
  if (stack.entries[stack.index] === url) return stack;

  const found = stack.entries.indexOf(url);
  if (found !== -1) return { entries: stack.entries, index: found };

  const entries = [...stack.entries.slice(0, stack.index + 1), url];
  return { entries, index: entries.length - 1 };
}

/** 当前指针之前是否存在历史条目(可后退)。残缺栈视为不可后退(防御,不崩溃)。 */
export function canGoBack(stack: HistoryStack): boolean {
  return !!stack && stack.index > 0;
}

/** 当前指针之后是否存在前进条目(可前进)。残缺栈视为不可前进(防御,不崩溃)。 */
export function canGoForward(stack: HistoryStack): boolean {
  return !!stack && stack.index < stack.entries.length - 1;
}

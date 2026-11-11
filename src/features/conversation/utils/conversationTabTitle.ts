/** Preferred short label for a conversation editor tab. */
export const CONVERSATION_TAB_TITLE_MAX_CHARS = 28;

/**
 * Build a tab-friendly title: collapse whitespace, cap length.
 *
 * 兜底链只有 `userTitle → title` 两级，**都是后端给的字符串**：wire 上的 `title` 永远非空
 * （无真标题时是 `title::placeholder_label` 合成的身份标签），所以这里不再编造
 * `agentId` / `'Conversation'` 之类的第三份兜底（红线 17：那是后端的影子副本，
 * 且会让「后端没给」永远看不见）。
 * Full title remains available via conversationMeta / hover tooltip.
 */
export function conversationTabTitle(
  // `title` 必填：wire 契约保证非空（无真标题时是后端合成的身份标签）。
  // 写成可选只会诱使调用方（或下一个改动）再加一条兜底。
  meta: { userTitle?: string | null; title: string },
  maxChars: number = CONVERSATION_TAB_TITLE_MAX_CHARS,
): string {
  const raw = (meta.userTitle?.trim() || meta.title.trim()).replace(/\s+/g, ' ');
  const chars = Array.from(raw);
  if (chars.length <= maxChars) return raw;
  const keep = Math.max(0, maxChars - 3);
  return `${chars.slice(0, keep).join('').trimEnd()}...`;
}

/** Preferred short label for a conversation editor tab. */
export const CONVERSATION_TAB_TITLE_MAX_CHARS = 28;

/**
 * Build a tab-friendly title: prefer userTitle, collapse whitespace, cap length.
 * Full title remains available via conversationMeta / hover tooltip.
 */
export function conversationTabTitle(
  meta: { userTitle?: string | null; title?: string | null; agentId?: string | null },
  maxChars: number = CONVERSATION_TAB_TITLE_MAX_CHARS,
): string {
  const raw = (meta.userTitle?.trim() || meta.title?.trim() || meta.agentId?.trim() || 'Conversation')
    .replace(/\s+/g, ' ');
  const chars = Array.from(raw);
  if (chars.length <= maxChars) return raw;
  const keep = Math.max(0, maxChars - 3);
  return `${chars.slice(0, keep).join('').trimEnd()}...`;
}

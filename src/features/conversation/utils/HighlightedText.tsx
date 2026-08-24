import React from 'react';

export type HighlightPart = { text: string; highlight: boolean } | string;

/**
 * 将 text 按 query（大小写不敏感）切分为片段，命中部分标记 highlight。
 * query 为空/无匹配时返回原始文本。
 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const q = query.trim();
  if (!q) return [text];

  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: HighlightPart[] = [];
  let cursor = 0;

  for (;;) {
    const idx = lower.indexOf(needle, cursor);
    if (idx === -1) break;
    if (idx > cursor) {
      parts.push(text.slice(cursor, idx));
    }
    parts.push({ text: text.slice(idx, idx + needle.length), highlight: true });
    cursor = idx + needle.length;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts.length > 0 ? parts : [text];
}

interface HighlightedTextProps {
  text: string;
  query: string;
}

/** 渲染带 <mark> 高亮的文本。 */
export const HighlightedText: React.FC<HighlightedTextProps> = React.memo(({ text, query }) => {
  const parts = highlightParts(text, query);
  return (
    <>
      {parts.map((part, idx) =>
        typeof part === 'string' ? (
          <span key={idx}>{part}</span>
        ) : (
          <mark key={idx} className="bg-accent-yellow/30 text-inherit rounded-sm px-0.5">
            {part.text}
          </mark>
        ),
      )}
    </>
  );
});
HighlightedText.displayName = 'HighlightedText';

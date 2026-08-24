import type { ConversationMessage } from '../types';

import { messageToText } from './messageToText';

/**
 * 在会话消息中查找包含 query（大小写不敏感）的消息索引。
 * 匹配范围：content + 所有 text blocks。
 */
export function findMessageMatches(messages: ConversationMessage[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const result: number[] = [];
  messages.forEach((msg, idx) => {
    const text = messageToText(msg).toLowerCase();
    if (text.includes(q)) {
      result.push(idx);
    }
  });
  return result;
}

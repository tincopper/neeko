import { useCallback, useMemo, useState } from 'react';

import type { ConversationMessage } from '../types';
import { findMessageMatches } from '../utils/conversationSearch';

/**
 * 会话内消息搜索状态：query → 匹配消息索引列表 + 当前匹配位置（循环导航）。
 */
export function useConversationSearch(messages: ConversationMessage[]) {
  const [query, setQueryRaw] = useState('');
  const [currentIdx, setCurrentIdx] = useState(0);

  const matches = useMemo(() => findMessageMatches(messages, query), [messages, query]);

  // query 变化时重置当前匹配到第一个
  const setQuery = useCallback((value: string) => {
    setQueryRaw(value);
    setCurrentIdx(0);
  }, []);

  const current = matches.length > 0 ? matches[Math.min(currentIdx, matches.length - 1)] : -1;

  const goToNext = useCallback(() => {
    setCurrentIdx((prev) => (prev + 1) % Math.max(matches.length, 1));
  }, [matches.length]);

  const goToPrev = useCallback(() => {
    setCurrentIdx((prev) => (prev - 1 + matches.length) % Math.max(matches.length, 1));
  }, [matches.length]);

  const clear = useCallback(() => {
    setQuery('');
    setCurrentIdx(0);
  }, [setQuery]);

  return {
    query,
    setQuery,
    matches,
    current,
    /** 当前匹配在 matches 中的序号（0-based），无匹配时为 -1。 */
    activeIndex: matches.length > 0 ? Math.min(currentIdx, matches.length - 1) : -1,
    goToNext,
    goToPrev,
    clear,
  };
}

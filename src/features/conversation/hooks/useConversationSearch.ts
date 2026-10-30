import { useCallback, useEffect, useState } from 'react';

import { searchConversationMessages } from '../api/conversationApi';
import type { ConversationSearchHit } from '../types';

/** 输入停顿多久后才向后端发起搜索。 */
const SEARCH_DEBOUNCE_MS = 200;

/**
 * 会话内消息搜索：query → 后端命中列表（定位 + 片段）+ 当前命中位置（循环导航）。
 *
 * 搜索在 Rust 侧扫描整段正文，因此前端不需要持有全量消息；命中只带 `seq`，
 * 视图按 `seq` 加载定位页（见 ConversationViewer 的 jumpToSeq）。
 */
export function useConversationSearch(conversationId: string | null) {
  const [query, setQueryRaw] = useState('');
  const [hits, setHits] = useState<ConversationSearchHit[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);

  const setQuery = useCallback((value: string) => {
    setQueryRaw(value);
    setCurrentIdx(0);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    // 空 query 直接不请求；展示侧用 effectiveHits 兜掉上一次搜索的残留
    if (!conversationId || trimmed.length === 0) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchConversationMessages(conversationId, trimmed)
        .then((next) => {
          if (!cancelled) setHits(next);
        })
        .catch((err) => {
          console.error('[useConversationSearch] Search failed:', err);
          if (!cancelled) setHits([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [conversationId, query]);

  const effectiveHits = query.trim().length === 0 ? [] : hits;
  const activeIndex =
    effectiveHits.length > 0 ? Math.min(currentIdx, effectiveHits.length - 1) : -1;
  const currentSeq = activeIndex >= 0 ? effectiveHits[activeIndex].seq : -1;

  const goToNext = useCallback(() => {
    setCurrentIdx((prev) => (prev + 1) % Math.max(effectiveHits.length, 1));
  }, [effectiveHits.length]);

  const goToPrev = useCallback(() => {
    setCurrentIdx((prev) => (prev - 1 + effectiveHits.length) % Math.max(effectiveHits.length, 1));
  }, [effectiveHits.length]);

  const clear = useCallback(() => {
    setQuery('');
    setHits([]);
    setCurrentIdx(0);
  }, [setQuery]);

  return {
    query,
    setQuery,
    hits: effectiveHits,
    activeIndex,
    currentSeq,
    goToNext,
    goToPrev,
    clear,
  };
}

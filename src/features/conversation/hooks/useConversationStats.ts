import { useEffect, useState } from 'react';

import { getConversationStats } from '../api/conversationApi';
import type { ConversationStats } from '../types';

const EMPTY_STATS: ConversationStats = {
  totalMessages: 0,
  toolCalls: 0,
  thinkingCount: 0,
  uniqueTools: [],
  toolCallList: [],
  toolCallListTruncated: false,
};

/**
 * 会话正文统计：数据由 Rust 侧汇总（工具调用清单 + thinking 计数）。
 *
 * 放后端的原因是红线 4 的同一动机 —— 前端不该为了「数一数工具调用」而把整段会话搬进内存。
 * 加载期间返回空统计，视图照常渲染正文。
 */
export function useConversationStats(conversationId: string | null): ConversationStats {
  // 连同 id 一起存：切换会话时旧数字不会冒充新会话（不必在 effect 里同步 setState）
  const [loaded, setLoaded] = useState<{ id: string; stats: ConversationStats } | null>(null);

  useEffect(() => {
    if (!conversationId) {
      return;
    }
    let cancelled = false;
    getConversationStats(conversationId)
      .then((next) => {
        if (!cancelled) setLoaded({ id: conversationId, stats: next });
      })
      .catch((err) => {
        console.error('[useConversationStats] Failed to load stats:', err);
        if (!cancelled) setLoaded({ id: conversationId, stats: EMPTY_STATS });
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // 没有会话 / 还没有该会话的数据时给空统计
  return conversationId && loaded?.id === conversationId ? loaded.stats : EMPTY_STATS;
}

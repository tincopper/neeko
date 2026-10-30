import { useCallback, useEffect, useRef, useState } from 'react';

import { getConversationMessagesPage } from '../api/conversationApi';
import type { ConversationMessage } from '../types';

export interface ConversationWindow {
  /** 当前已加载的连续窗口（时间正序） */
  messages: ConversationMessage[];
  /** 会话消息总数（后端） */
  total: number;
  /** `messages[0]` 在整段会话里的绝对下标 */
  startIndex: number;
  loading: boolean;
  loadingEarlier: boolean;
  hasEarlier: boolean;
  hasLater: boolean;
  /** 向上加载一页更早的消息；返回是否确实加载了内容（供调用方保持滚动位置） */
  loadEarlier: () => Promise<boolean>;
  /** 若目标消息不在窗口内，切换窗口到包含它的那一页；返回其在窗口内的下标（未找到为 -1） */
  jumpToSeq: (seq: number) => Promise<number>;
  /** 把窗口拉回最新（尾页） */
  jumpToLatest: () => Promise<number>;
}

/**
 * 正文窗口：正文视图只持有「当前窗口」，而不是整段会话（红线 4 的同一动机）。
 *
 * 首屏取尾页（`fromEnd`），向上按需加载更早的页；搜索命中 / 工具调用跳转时，
 * 若目标不在窗口内则按 `seq` 取定位页替换窗口。
 */
export function useConversationWindow(conversationId: string): ConversationWindow {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [startIndex, setStartIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  // 回调只依赖 conversationId（稳定身份），最新窗口状态从 ref 读 ——
  // 否则每次翻页都会换掉 jumpToSeq 的引用，连带触发视图里的搜索跳转 effect 重跑。
  const windowRef = useRef({ messages, total, startIndex });
  const earlierInFlightRef = useRef(false);

  useEffect(() => {
    windowRef.current = { messages, total, startIndex };
  }, [messages, total, startIndex]);

  const applyPage = useCallback(
    (page: { items: ConversationMessage[]; total: number; offset: number }) => {
      setMessages(page.items);
      setTotal(page.total);
      setStartIndex(page.offset);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    // 同步 setState 会触发级联渲染（react-hooks/set-state-in-effect）：推迟一个微任务，
    // 与 useConversationDetail 的处理方式一致。
    Promise.resolve().then(() => {
      if (!cancelled) setLoading(true);
    });
    getConversationMessagesPage(conversationId, 0, { fromEnd: true })
      .then((page) => {
        if (cancelled) return;
        applyPage(page);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[useConversationWindow] Failed to load messages:', err);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, applyPage]);

  const loadEarlier = useCallback(async () => {
    const snapshot = windowRef.current;
    if (earlierInFlightRef.current || snapshot.startIndex === 0) return false;
    earlierInFlightRef.current = true;
    setLoadingEarlier(true);
    try {
      const page = await getConversationMessagesPage(
        conversationId,
        snapshot.total - snapshot.startIndex,
        { fromEnd: true },
      );
      if (page.items.length === 0) return false;
      setMessages((prev) => [...page.items, ...prev]);
      setStartIndex(page.offset);
      return true;
    } catch (err) {
      console.error('[useConversationWindow] Failed to load earlier messages:', err);
      return false;
    } finally {
      earlierInFlightRef.current = false;
      setLoadingEarlier(false);
    }
  }, [conversationId]);

  const jumpToSeq = useCallback(
    async (seq: number) => {
      const snapshot = windowRef.current;
      const loadedIdx = snapshot.messages.findIndex((m) => m.seq === seq);
      if (loadedIdx >= 0) return loadedIdx;
      try {
        const offsetFromEnd = Math.max(0, snapshot.total - seq - 1);
        const page = await getConversationMessagesPage(conversationId, offsetFromEnd, {
          fromEnd: true,
        });
        applyPage(page);
        return page.items.findIndex((m) => m.seq === seq);
      } catch (err) {
        console.error('[useConversationWindow] Failed to jump to message:', err);
        return -1;
      }
    },
    [applyPage, conversationId],
  );

  const jumpToLatest = useCallback(async () => {
    try {
      const page = await getConversationMessagesPage(conversationId, 0, { fromEnd: true });
      applyPage(page);
      return page.items.length - 1;
    } catch (err) {
      console.error('[useConversationWindow] Failed to return to latest messages:', err);
      return -1;
    }
  }, [applyPage, conversationId]);

  return {
    messages,
    total,
    startIndex,
    loading,
    loadingEarlier,
    hasEarlier: startIndex > 0,
    hasLater: startIndex + messages.length < total,
    loadEarlier,
    jumpToSeq,
    jumpToLatest,
  };
}

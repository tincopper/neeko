import { useCallback, useEffect, useRef, useState } from 'react';

import { copyConversationMarkdown, getConversationMessages } from '../api/conversationApi';
import type { ConversationMessage } from '../types';

export function useConversationDetail(conversationId: string | null) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(false);
  // 正文是多页传输（红线 4），加载窗口变长：切会话时旧请求的落地结果必须丢弃
  const requestIdRef = useRef(0);

  const loadMessages = useCallback(async (id: string) => {
    const requestId = ++requestIdRef.current;
    const isStale = () => requestId !== requestIdRef.current;
    setLoading(true);
    try {
      const msgs = await getConversationMessages(id);
      if (isStale()) return;
      setMessages(msgs);
    } catch (err) {
      if (isStale()) return;
      console.error('[useConversationDetail] Failed to load messages:', err);
      setMessages([]);
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (conversationId) {
      // Defer to avoid sync setState in effect (loadMessages calls setLoading synchronously)
      Promise.resolve().then(() => loadMessages(conversationId));
    }
  }, [conversationId, loadMessages]);

  /**
   * 整段会话写入剪贴板（Rust 侧生成并直写，不经 IPC 回传正文）。
   *
   * 返回写入的字符数；失败返回 null。
   */
  const handleExport = useCallback(async (id: string): Promise<number | null> => {
    try {
      return await copyConversationMarkdown(id);
    } catch (err) {
      console.error('[useConversationDetail] Export failed:', err);
      return null;
    }
  }, []);

  return { messages: conversationId ? messages : [], loading, copyMarkdown: handleExport };
}

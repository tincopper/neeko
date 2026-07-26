import { useCallback, useEffect, useState } from 'react';

import { getConversationMessages, exportConversation } from '../api/conversationApi';
import type { ConversationMessage } from '../types';

export function useConversationDetail(conversationId: string | null) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const loadMessages = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const msgs = await getConversationMessages(id);
      setMessages(msgs);
    } catch (err) {
      console.error('[useConversationDetail] Failed to load messages:', err);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (conversationId) {
      // Defer to avoid sync setState in effect (loadMessages calls setLoading synchronously)
      Promise.resolve().then(() => loadMessages(conversationId));
    }
  }, [conversationId, loadMessages]);

  const handleExport = useCallback(async (id: string): Promise<string | null> => {
    try {
      return await exportConversation(id);
    } catch (err) {
      console.error('[useConversationDetail] Export failed:', err);
      return null;
    }
  }, []);

  return { messages: conversationId ? messages : [], loading, exportConversation: handleExport };
}

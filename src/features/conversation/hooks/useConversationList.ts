import { useState, useEffect, useCallback } from 'react';
import { scanConversations, listConversations } from '../api/conversationApi';
import type { ConversationMeta } from '../types';

export function useConversationList(
  projectPath: string | null,
  isActive: boolean,
  agentFilter?: string,
) {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectPath) {
      setConversations([]);
      return;
    }
    setLoading(true);
    try {
      // Scan for new conversations first
      await scanConversations(agentFilter);
      // Then fetch the cached list
      const list = await listConversations(projectPath, agentFilter);
      setConversations(list);
    } catch (err) {
      console.error('[useConversationList] Failed to load conversations:', err);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [projectPath, agentFilter]);

  // Auto-load when panel becomes active or project changes
  useEffect(() => {
    if (isActive && projectPath) {
      refresh();
    }
  }, [isActive, projectPath, refresh]);

  return { conversations, loading, refresh };
}

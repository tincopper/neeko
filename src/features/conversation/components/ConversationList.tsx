import React, { useCallback } from 'react';
import ConversationItem from './ConversationItem';
import type { ConversationMeta } from '../types';
import type { AgentConfig } from '@/features/agent/types';

interface ConversationListProps {
  conversations: ConversationMeta[];
  agents: AgentConfig[];
  loading: boolean;
  onView: (meta: ConversationMeta) => void;
  onResume: (meta: ConversationMeta) => void;
}

const ConversationList: React.FC<ConversationListProps> = React.memo(({
  conversations,
  agents,
  loading,
  onView,
  onResume,
}) => {
  const handleView = useCallback((meta: ConversationMeta) => {
    onView(meta);
  }, [onView]);

  const handleResume = useCallback((meta: ConversationMeta) => {
    onResume(meta);
  }, [onResume]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-text-secondary/60">
        Loading conversations...
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <p className="text-xs text-text-secondary/60">No conversations yet</p>
        <p className="text-[11px] text-text-secondary/40 text-center px-4">
          Start chatting with an agent to see your conversations here
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-2 py-2">
      {conversations.map((meta) => (
        <ConversationItem
          key={meta.id}
          meta={meta}
          agents={agents}
          onView={handleView}
          onResume={handleResume}
        />
      ))}
    </div>
  );
});
ConversationList.displayName = 'ConversationList';

export default ConversationList;

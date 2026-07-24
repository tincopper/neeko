import React, { useCallback, useMemo } from 'react';
import ConversationItem from './ConversationItem';
import { groupConversationsByDate } from '../utils/groupByDate';
import type { ConversationMeta } from '../types';
import type { AgentConfig } from '@/features/agent/types';

interface ConversationListProps {
  conversations: ConversationMeta[];
  agents: AgentConfig[];
  loading: boolean;
  activeId?: string | null;
  onView: (meta: ConversationMeta) => void;
  onResume: (meta: ConversationMeta) => void;
}

const ConversationList: React.FC<ConversationListProps> = React.memo(({
  conversations,
  agents,
  loading,
  activeId,
  onView,
  onResume,
}) => {
  const handleView = useCallback((meta: ConversationMeta) => {
    onView(meta);
  }, [onView]);

  const handleResume = useCallback((meta: ConversationMeta) => {
    onResume(meta);
  }, [onResume]);

  const groups = useMemo(
    () => groupConversationsByDate(conversations),
    [conversations],
  );

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
    <div className="flex flex-col py-1">
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col">
          <h4
            className={
              'sticky top-0 z-10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ' +
              'text-text-muted bg-bg-primary/95 backdrop-blur-sm'
            }
          >
            {group.label}
          </h4>
          <div className="flex flex-col px-1">
            {group.items.map((meta) => (
              <ConversationItem
                key={meta.id}
                meta={meta}
                agents={agents}
                active={activeId === meta.id}
                onView={handleView}
                onResume={handleResume}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
});
ConversationList.displayName = 'ConversationList';

export default ConversationList;

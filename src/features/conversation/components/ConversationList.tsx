import React, { useCallback, useMemo } from 'react';
import ConversationItem from './ConversationItem';
import ConversationListSkeleton from './ConversationListSkeleton';
import { groupConversationsByDate } from '../utils/groupByDate';
import type { ConversationMeta } from '../types';
import type { AgentConfig } from '@/features/agent/types';

interface ConversationListProps {
  conversations: ConversationMeta[];
  agents: AgentConfig[];
  /** Hard loading: no rows yet (first hydrate / first scan). */
  loading: boolean;
  /** Soft background refresh; list stays visible. */
  refreshing?: boolean;
  activeId?: string | null;
  onView: (meta: ConversationMeta) => void;
  onResume: (meta: ConversationMeta) => void;
}

const ConversationList: React.FC<ConversationListProps> = React.memo(({
  conversations,
  agents,
  loading,
  refreshing = false,
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

  // Fishbone: empty + still loading/refreshing → skeleton, never flash empty state early.
  if (loading || (conversations.length === 0 && refreshing)) {
    return <ConversationListSkeleton />;
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
    <div className="flex flex-col py-1 relative">
      {refreshing ? (
        <div className="sticky top-0 z-20 flex justify-center pointer-events-none">
          <span className="text-[10px] text-text-muted bg-bg-primary/90 px-2 py-0.5 rounded-b-md border border-border/60 border-t-0">
            Updating…
          </span>
        </div>
      ) : null}
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
